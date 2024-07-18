import { parseGrid } from "./buildGrid.js";
import { getButtonDiv } from "./questButtons.js";

self.onmessage = (event) => {
  if (event.data.command === 'initialize') {
    self.postMessage('ready');
  } else if (event.data.command === 'transform') {
    const [contents, precalculated_values, i18n, isEmbeddedSurvey] = event.data.data;
    const transformResult = transformMarkdownToHTML(contents, precalculated_values, i18n, isEmbeddedSurvey);
    self.postMessage({ command: 'transformDone', result: transformResult });
  }
}

let paramSplit = (str) =>
  [...str.matchAll(/(\w+)=(\s?.+?)\s*(?=\w+=|$)/gm)].reduce((pv, cv) => {
    pv[cv[1]] = encodeURIComponent(cv[2]);
    return pv
  }, {})

let reduceObj = (obj) => {
  //replace options with split values (uri encoded)
  return Object.entries(obj).reduce((pv, cv) => {
      return pv += ` ${cv[0]}=${cv[1]}`
  }, "").trim()
}

// This routine takes the markdown contents and converts it to HTML
// It's called from (1) the worker thread, (2) the worker's 'onerror' to process inline if the worker fails.
export function transformMarkdownToHTML(contents, precalculated_values, i18n) {
  // build the buttons
  const button_text_obj = {
    back: i18n.backButton,
    reset: i18n.resetAnswerButton,
    next: i18n.nextButton,
    submit: i18n.submitSurveyButton
  }

  // Define the Date function dateToQuestFormat
  const dateToQuestFormat = (date) => {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }
  
  // first... build grids...
  const grid_replace_regex = /\|grid(\!|\?)*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/g;
  contents = contents.replace(grid_replace_regex, (...args) => parseGrid(...args, button_text_obj));

  // then we must unroll the loops...
  contents = unrollLoops(contents, i18n.language);
  
  // #issue 378, note: getMonth 0=Jan,  need to add 1
  contents = contents
    .replace(/#currentMonthStr/g, i18n.months[precalculated_values.current_month_str])
    .replace(/#currentMonth/g, precalculated_values.current_month)
    .replace(/#currentYear/g, precalculated_values.current_year)

    // issue #405 need #today and today+/- n days...
    // offset is a number of days to add or subtract from today. E.g. offset of -60 in markdown: `|date|min=#today-60 max=#today|`
    .replace(/#today(\s*[+\-]\s*\d+)?/g, (match, offset) => {
      // if no (+/- offset) we want today...
      if (!offset || offset.trim().length == 0) {
        return precalculated_values.quest_format_date;
      }

      // otherwise +/- the offset in number of days...
      offset = parseInt(offset.replace(/\s/g, ""));
      let offset_date = precalculated_values.current_date
      offset_date.setDate(precalculated_values.current_day + offset)
      return dateToQuestFormat(offset_date);
    })

    // questionnarie 
    // hey, lets de-lint the contents.. convert (^|\n{2,}Q1. to [Q1]
    // note:  the first question wont have the \n\n so we need to look at start of string(^)
    .replace(/\/\*.*\*\//g, "")
    .replace(/\/\/.*/g, "");

  let questName = 'Questionnaire'; // this is the name of the questionnaire. Either the module ID or 'Questionnaire'. Find in the questionnaire as {"name":"moduleID"}
  const questModuleNameRegExp = new RegExp(/{"name":"(\w*)"}/);
  if (questModuleNameRegExp.test(contents)) {
    contents = contents.replace(/{"name":"(\w*)"}/, fQuestModuleNameID);
    function fQuestModuleNameID(group, moduleID) {
      questName = moduleID;
      return "";
    }
  }

  // first let's deal with breaking up questions..
  // a question starts with the [ID1] regex pattern
  // and end with the next pattern or the end of string...

  // start with a '['
  // then the first character must be a capital letter
  // followed by zero or more capital letters/digits or an _
  // note: we want this possessive (NOT greedy) so add a ?
  //       otherwise it would match the first and last square bracket


  const questionSeparatorRegExp = new RegExp(
    "\\[([A-Z_][A-Z0-9_#]*[\\?\\!]?)(?:\\|([^,\\|\\]]+)\\|?)?(,.*?)?\\](.*?)(?=$|\\[[_A-Z]|<form)",
    "g"
  );

  // because firefox cannot handle the "s" tag, encode all newlines
  // as a unit seperator ASCII code 1f (decimal: 31)
  contents = contents.replace(/(?:\r\n|\r|\n)/g, "\u001f");
  contents = contents.replace(questionSeparatorRegExp, function (
    page,
    questID,
    questOpts,
    questArgs,
    questText
  ) {

    questText = questText.replace(/\u001f/g, "\n");
    questText = questText.replace(/(?:\r\n|\r|\n)/g, "<br>");
    questText = questText.replace(/\[_#\]/g, "");
    let counter = 1;
    questText = questText.replace(/\[\]/g, function (x) {
      let t = "[" + counter.toString() + "]";
      counter = counter + 1;
      return t;
    });

    //handle options for question
    questOpts = questOpts ? questOpts : "";
    questOpts = questOpts.replaceAll(/(min|max)-count\s*=\s*(\d+)/g,'data-$1-count=$2')

    // handle displayif on the question...
    // if questArgs is undefined set it to blank.
    questArgs = questArgs ? questArgs : "";

    // make sure that this is a "displayif"
    const displayifMatch = questArgs.match(/displayif\s*=\s*.*/);
    const endMatch = questArgs.match(/end\s*=\s*(.*)?/);
    // if so, remove the comma and go.  if not, set questArgs to blank...
    if (displayifMatch) {
      questArgs = displayifMatch[0];
      questArgs = `displayif=${encodeURIComponent(displayifMatch[0].slice(displayifMatch[0].indexOf('=') + 1))}`
    } else if (endMatch) {
      questArgs = endMatch[0];
    } else {
      questArgs = "";
    }

    let target = "";

    let hardBool = questID.endsWith("!");
    let softBool = questID.endsWith("?");
    if (hardBool || softBool) {
      questID = questID.slice(0, -1);
      if (hardBool) {
        target = "data-target='#hardModal'";
      } else {
        target = "data-target='#softModal'";
      }
    }

    // Worker doesn't have window context/access, so needed to be pre-calculated instead of accessing math._value.
    // replace user profile variables...
    questText = questText.replace(/\{\$u:(\w+)}/g, (all, varid) => {
      return `<span name='${varid}'>${precalculated_values[varid] || ''}</span>`;
    });

    // replace {$id} with span tag
    questText = questText.replace(/\{\$(\w+(?:\.\w+)?):?([a-zA-Z0-9 ,.!?"-]*)\}/g, fID);
    function fID(fullmatch, forId, optional) {
      if (optional == undefined) {
        optional = "";
      } else {
        optional = optional;
      }
      return `<span forId='${forId}' optional='${optional}'>${forId}</span>`;
    }
    // replace {#id} with span tag
    questText=questText.replace(/\{\#([^}#]+)\}/g,fHash)
    function fHash(fullmatch,expr){
      return `<span data-encoded-expression=${encodeURIComponent(expr)}>${expr}</span>`
    }

    //adding displayif with nested questions. nested display if uses !| to |!
    questText = questText.replace(/!\|(displayif=.+?)\|(.*?)\|!/g, fDisplayIf);
    function fDisplayIf(containsGroup, condition, text) {
      text = text.replace(/\|(?:__\|){2,}(?:([^\|\<]+[^\|]+)\|)?/g, fNum);
      text = text.replace(/\|popup\|([^|]+)\|(?:([^|]+)\|)?([^|]+)\|/g, fPopover);
      text = text.replace(/\|@\|(?:([^\|\<]+[^\|]+)\|)?/g, fEmail);
      text = text.replace(/\|date\|(?:([^\|\<]+[^\|]+)\|)?/g, fDate);
      text = text.replace(/\|tel\|(?:([^\|\<]+[^\|]+)\|)?/g, fPhone);
      text = text.replace(/\|SSN\|(?:([^\|\<]+[^\|]+)\|)?/g, fSSN);
      text = text.replace(/\|state\|(?:([^\|\<]+[^\|]+)\|)?/g, fState);
      text = text.replace(/\((\d*)(?:\:(\w+))?(?:\|(\w+))?(?:,(displayif=.+\))?)?\)(.*?)(?=(?:\(\d)|\n|<br>|$)/g, fRadio);
      text = text.replace(/\[(\d*)(\*)?(?:\:(\w+))?(?:\|(\w+))?(?:,(displayif=.+?\))?)?\]\s*(.*?)\s*(?=(?:\[\d)|\n|<br>|$)/g, fCheck);
      text = text.replace(/\[text\s?box(?:\s*:\s*(\w+))?\]/g, fTextBox);
      text = text.replace(/\|(?:__\|)(?:([^\s<][^|<]+[^\s<])\|)?\s*(.*?)/g, fText);
      text = text.replace(/\|___\|((\w+)\|)?/g, fTextArea);
      text = text.replace(/\|time\|(?:([^\|\<]+[^\|]+)\|)?/g, fTime);
      text = text.replace(/#YNP/g, translate('yesNoPrefer')); //check
      text = questText.replace(/#YN/g, translate('yesNo')); //check

      return `<span class='displayif' ${condition}>${text}</span>`;
    }

    //replace |popup|buttonText|Title|text| with a popover
    questText = questText.replace(
      /\|popup\|([^|]+)\|(?:([^|]+)\|)?([^|]+)\|/g,
      fPopover
    );
    function fPopover(fullmatch, buttonText, title, popText) {
      title = title ? title : "";
      popText = popText.replace(/"/g, "&quot;")
      return `<a tabindex="0" class="popover-dismiss btn" role="button" title="${title}" data-toggle="popover" data-bs-toggle="popover" data-trigger="focus" data-bs-trigger="focus" data-content="${popText}" data-bs-content="${popText}">${buttonText}</a>`;
    }

    // replace |hidden|value| 
    questText = questText.replace(/\|hidden\|\s*id\s*=\s*([^\|]+)\|?/g, fHide);
    function fHide(fullmatch, id) {
      return `<input type="text" data-hidden=true id=${id}>`
    }

    // replace |@| with an email input
    questText = questText.replace(/\|@\|(?:([^\|\<]+[^\|]+)\|)?/g, fEmail);
    function fEmail(fullmatch, opts) {
      const { options, elementId } = guaranteeIdSet(opts, "email");
      return `<input type='email' ${options} placeholder="user@example.com"></input>`;
    }

    // replace |date| with a date input
    questText = questText.replace(/\|date\|(?:([^\|\<]+[^\|]+)\|)?/g, fDate);
    questText = questText.replace(/\|month\|(?:([^\|]+)\|)?/g, fDate);
    function fDate(fullmatch, opts) {
      let type = fullmatch.match(/[^|]+/);
      let { options, elementId } = guaranteeIdSet(opts, type);
      let optionObj = paramSplit(options);
      // can't have the value uri encoded... 
      if (optionObj.hasOwnProperty("value")) {
          optionObj.value = decodeURIComponent(optionObj.value);
      }
  
      options = reduceObj(optionObj);

      if (optionObj.hasOwnProperty("min")) {
        options = options + ` data-min-date-uneval=${optionObj.min}`
      }
      if (optionObj.hasOwnProperty("max")) {
        options = options + `  data-max-date-uneval=${optionObj.max}`
      }
      
      const descText = type === 'month' ? "Type month and four-digit year" : type === 'date' ? "Select a date" : "Enter the month and year in format: four digit year - two digit month. YYYY-MM";
  
      // Adding placeholders and aria-describedby attributes in one line
      options += ` placeholder='Select ${type}' aria-describedby='${elementId}-desc' aria-label='Select ${type}'`;
      return `<input type='${type}' ${options}><span id='${elementId}-desc' class='sr-only'>${descText}</span>`;
    }

    // replace |tel| with phone input

    questText = questText.replace(/\|tel\|(?:([^\|\<]+[^\|]+)\|)?/g, fPhone);
    function fPhone(fullmatch, opts) {
      const { options, elementId } = guaranteeIdSet(opts, "tel");
      return `<input type='tel' ${options} pattern="[0-9]{3}-?[0-9]{3}-?[0-9]{4}" maxlength="12" placeholder='###-###-####'></input>`;
    }

    // replace |SSN| with SSN input
    questText = questText.replace(/\|SSN\|(?:([^\|\<]+[^\|]+)\|)?/g, fSSN);
    function fSSN(fullmatch, opts) {
      const { options, elementId } = guaranteeIdSet(opts, "SSN");
      return `<input type='text' ${options} id="SSN" class="SSN" inputmode="numeric" maxlength="11" pattern="[0-9]{3}-?[0-9]{2}-?[0-9]{4}"   placeholder="_ _ _-_ _-_ _ _ _"></input>`;
    }



    // replace |SSNsm| with SSN input
    questText = questText.replace(/\|SSNsm\|(?:([^\|\<]+[^\|]+)\|)?/g, fSSNsm);
    function fSSNsm(fullmatch, opts) {
      const { options, elementId } = guaranteeIdSet(opts, "SSNsm");
      return `<input type='text' ${options} class="SSNsm" inputmode="numeric" maxlength="4" pattern='[0-9]{4}'placeholder="_ _ _ _"></input>`;
    }

    // replace |state| with state dropdown
    questText = questText.replace(/\|state\|(?:([^\|\<]+[^\|]+)\|)?/g, fState);
    function fState(fullmatch, opts) {
      const { options, elementId } = guaranteeIdSet(opts, "state");
      return `<select ${options}>
        <option value='' disabled selected>${i18n.chooseState}: </option>
        <option value='AL'>Alabama</option>
        <option value='AK'>Alaska</option>
        <option value='AZ'>Arizona</option>
        <option value='AR'>Arkansas</option>
        <option value='CA'>California</option>
        <option value='CO'>Colorado</option>
        <option value='CT'>Connecticut</option>
        <option value='DE'>Delaware</option>
        <option value='DC'>District Of Columbia</option>
        <option value='FL'>Florida</option>
        <option value='GA'>Georgia</option>
        <option value='HI'>Hawaii</option>
        <option value='ID'>Idaho</option>
        <option value='IL'>Illinois</option>
        <option value='IN'>Indiana</option>
        <option value='IA'>Iowa</option>
        <option value='KS'>Kansas</option>
        <option value='KY'>Kentucky</option>
        <option value='LA'>Louisiana</option>
        <option value='ME'>Maine</option>
        <option value='MD'>Maryland</option>
        <option value='MA'>Massachusetts</option>
        <option value='MI'>Michigan</option>
        <option value='MN'>Minnesota</option>
        <option value='MS'>Mississippi</option>
        <option value='MO'>Missouri</option>
        <option value='MT'>Montana</option>
        <option value='NE'>Nebraska</option>
        <option value='NV'>Nevada</option>
        <option value='NH'>New Hampshire</option>
        <option value='NJ'>New Jersey</option>
        <option value='NM'>New Mexico</option>
        <option value='NY'>New York</option>
        <option value='NC'>North Carolina</option>
        <option value='ND'>North Dakota</option>
        <option value='OH'>Ohio</option>
        <option value='OK'>Oklahoma</option>
        <option value='OR'>Oregon</option>
        <option value='PA'>Pennsylvania</option>
        <option value='RI'>Rhode Island</option>
        <option value='SC'>South Carolina</option>
        <option value='SD'>South Dakota</option>
        <option value='TN'>Tennessee</option>
        <option value='TX'>Texas</option>
        <option value='UT'>Utah</option>
        <option value='VT'>Vermont</option>
        <option value='VA'>Virginia</option>
        <option value='WA'>Washington</option>
        <option value='WV'>West Virginia</option>
        <option value='WI'>Wisconsin</option>
        <option value='WY'>Wyoming</option>
      </select>`;
    }


    function guaranteeIdSet(options, inputType = "inp") {
      if (options == undefined) {
        options = "";
      }
      options = options.trim();
      let elementId = options.match(/id=([^\s]+)/);
      if (!elementId) {
        elementId = `${questID}_${inputType}`;
        options = `${options} id=${elementId}`;
      } else {
        elementId = elementId[1];
      }
      return { options: options, elementId: elementId };
    }

    // replace |image|URL|height,width| with a html img tag...
    questText = questText.replace(
      /\|image\|(.*?)\|(?:([0-9]+),([0-9]+)\|)?/g,
      "<img src=https://$1 height=$2 width=$3 loading='lazy'>"
    );

    //regex to test if there are input as a part of radio or checkboxes
    let radioCheckboxAndInput = false;
    if (questText.match(/(\[|\()(\d*)(?:\:(\w+))?(?:\|(\w+))?(?:,(displayif=.+?\))?)?(\)|\])\s*(.*?\|_.*?\|)/g)) {
      radioCheckboxAndInput = true;
      questOpts = questOpts + " radioCheckboxAndInput";
    }

    questText = questText.replace(/<br>/g, "<br>\n");

    // replace (XX) with a radio button...

    // buttons can have a displayif that contains recursive
    // parentheses.  Regex in JS currently does not support
    // recursive pattern matching.  So, I look for the start
    // of the radio button, a left parenthesis, with a digit
    // along with other optional arguments.  the handleButton
    // function returns the entire string that gets matched, 
    // similar to string.replace
    function handleButton(match) {
      let value = match[1];
      let radioElementName = !!match[2] ? match[2] : questID;
      let labelID = !!match[3] ? match[3] : `${radioElementName}_${value}_label`;

      // finds real end
      let cnt = 0;
      let end = 0;
      for (let i = match.index; i < match.input.length; i++) {
        if (match.input[i] == "(") cnt++;
        if (match.input[i] == ")") cnt--;
        if (match.input[i] == "\n") break;

        end = i + 1;
        if (cnt == 0) break;
      }

      // need to have the displayif=... in the variable display_if otherwise if
      // you have displayif={displayif} displayif will be false if empty.
      let radioButtonMetaData = match.input.substring(match.index, end);
      let display_if = !!match[4] ? radioButtonMetaData.substring(radioButtonMetaData.indexOf(match[4]), radioButtonMetaData.length - 1).trim() : "";
      display_if = (!!display_if) ? `displayif=${encodeURIComponent(display_if)}` : ""
      let label_end = match.input.substring(end).search(/\n|(?:<br>|$)/) + end;
      let label = match.input.substring(end, label_end);
      let replacement = `<div class='response' ${display_if}><input type='radio' name='${radioElementName}' value='${value}' id='${radioElementName}_${value}'></input><label id='${labelID}' for='${radioElementName}_${value}'>${label}</label></div>`;

      return match.input.substring(0, match.index) + replacement + match.input.substring(label_end);
    }
    /*
      \((\d+)       Required: (value
      (?:\:(\w+))?  an optional :name for the input
      (?:\|(\w+))?  an optional |label
      (?:,displayif=([^)]*))?  an optional display if.. up to the first close parenthesis
      (\s*\))     Required: close paren with optional space in front.
    */
    let buttonRegex = /\((\d+)(?:\:(\w+))?(?:\|(\w+))?(?:,displayif=([^)]*))?(\s*\))/;
    for (let match = questText.match(buttonRegex); !!match; match = questText.match(buttonRegex)) {
      questText = handleButton(match);
    }

    // replace [XX] with checkbox
    // The "displayif" is reading beyond the end of the pattern ( displayif=.... )
    // let cbRegEx = new RegExp(''
    //   + /\[(d*)(\*)?(?:\:(\w+))?/.source              // (digits with a potential * and :name
    //   + /(?:\|(\w+))?/.source                         // an optional id for the label
    //   + /(?:,(displayif=.+?\))?)?/.source             // an optional displayif
    //   + /\]\s*(.*?)\s*(?=(?:\[\d)|\n|<br>|$)/         // go to the end of the line or next [
    // )

    questText = questText.replace(
      /\[(\d*)(\*)?(?:\:(\w+))?(?:\|(\w+))?(?:,(displayif\s*=\s*.+?\)\s*)?)?\]\s*(.*?)\s*(?=(?:\[\d)|\n|<br>|$)/g,
      fCheck
    );
    function fCheck(containsGroup, value, noneOfTheOthers, name, labelID, condition, label) {
      let displayIf = "";
      let clearValues = noneOfTheOthers ? "data-reset=true" : "";
      if (condition == undefined) {
        displayIf = "";
      } else {
        displayIf = `displayif=${encodeURIComponent(condition.slice(condition.indexOf('=') + 1))}`;
      }
      let elVar = "";
      if (name == undefined) {
        elVar = questID;
      } else {
        elVar = name;
      }
      if (labelID == undefined) {
        labelID = `${elVar}_${value}_label`;
      }

      return `<div class='response' ${displayIf}><input type='checkbox' name='${elVar}' value='${value}' id='${elVar}_${value}' ${clearValues}></input><label id='${labelID}' for='${elVar}_${value}'>${label}</label></div>`;
    }

    // replace |time| with a time input
    questText = questText.replace(/\|time\|(?:([^\|\<]+[^\|]+)\|)?/g, fTime);
    function fTime(x, opts) {
      const { options, elementId } = guaranteeIdSet(opts, "time");
      return `
        <label for='${elementId}' class='sr-only'>Enter Time</label>
        <input type='time' id='${elementId}' ${options} aria-label='Enter Time'>
      `;
    }

    // TODO: General: format for number input boxes needs adjustment for screen readers (description text first or aria description)
    // replace |__|__|  with a number box...
    questText = questText.replace(
      /\|(?:__\|){2,}(?:([^\|\<]+[^\|]+)\|)?/g,
      fNum
    );
    function fNum(fullmatch, opts) {
      const value = questText.startsWith('<br>') ? questText.split('<br>')[0] : '';
      // make sure that the element id is set...
      let { options, elementId } = guaranteeIdSet(opts, "num");
      
      options = options.replaceAll('\"', "\'");
      //instead of replacing max and min with data-min and data-max, they need to be added, as the up down buttons are needed for input type number
      let optionObj = paramSplit(options)

      //replace options with split values (uri encoded)
      options = reduceObj(optionObj)
      if (optionObj.hasOwnProperty("min")) {
        options = options + ` data-min="${optionObj.min}"`
      }
      if (optionObj.hasOwnProperty("max")) {
        options = options + ` data-max="${optionObj.max}"`
      }

      // Handle not converted and not yet calculated min and max values
      const minMaxValueTest = (value) => { return value && !value.startsWith('valueOr') && !value.includes('isDefined') && value !== '0' ? value : ''; }
      const min = minMaxValueTest(optionObj.min);
      const max = minMaxValueTest(optionObj.max);

      // Build the description text
      const descriptionText = `This field accepts numbers. Please enter a whole number ${min && max ? 'between ' + min + ' and ' + max : ''}.`;
      
      // Add placeholder and aria-describedby
      const placeholder = min ? `placeholder="${i18n.example}: ${min}"` : (max ? `placeholder="${i18n.example}: ${max}"` : `placeholder=${i18n.enterValue}`);
      options += ` ${placeholder} aria-describedby="${elementId}-desc"`;

      //onkeypress forces whole numbers
      return `<input type='number' aria-label='${value}' step='any' onkeypress='return (event.charCode == 8 || event.charCode == 0 || event.charCode == 13) ? null : event.charCode >= 48 && event.charCode <= 57' name='${questID}' ${options}>
              <div id="${elementId}-desc" class="sr-only">${descriptionText}</div><br>`;
    }

    // replace |__| or [text box:xxx] with an input box...
    questText = questText.replace(/\[text\s?box(?:\s*:\s*(\w+))?\]/g, fTextBox);
    function fTextBox(fullmatch, options) {
      let id = options ? options : `${questID}_text`;
      return `|__|id=${id} name=${questID}|`;
    }


    questText = questText.replace(
      /(.*)?\|(?:__\|)(?:([^\s<][^|<]+[^\s<])\|)?(.*)?/g,
      fText
    );

    // TODO: Inspect ServiceNow/DataDog 'Too Much Recursion' error (Windows 10 / Firefox v125.0.0). One occurrence 5/3/24, Module 4.
    function fText(fullmatch, value1, opts, value2) {
      let { options, elementId } = guaranteeIdSet(opts, "txt");
      options = options.replaceAll(/(min|max)len\s*=\s*(\d+)/g,'data-$1len=$2')
      // if value1 or 2 contains an apostrophe, convert it to
      // and html entity.  This may need to be preformed in other parts
      // the code. As it turns out.  This causes a problem.  Only change the values in the aria-label.
      // if you have (1) xx |__| text with  ' in it.
      // then the apostrophe is put in the aria-label screwing up the rendering 

      // this is really ugly..  What is going on here?
      // TODO: refactor, test, and remove this console.warn
      //if (value1 && value1.includes('div')) console.warn('fText:', value1, opts, value2);
      if (value1 && value1.includes('div')) return `${value1}<input type='text' aria-label='${value1.split('>').pop().replace(/'/g, "&apos;")}'name='${questID}' ${options}></input>${value2}`
      if (value1 && value2) return `<span>${value1}</span><input type='text' aria-label='${value1.replace(/'/g, "&apos;")} ${value2.replace(/'/g, "&apos;")}' name='${questID}' ${options}></input><span>${value2}</span>`;
      if (value1) return `<span>${value1}</span><input type='text' aria-label='${value1.replace(/'/g, "&apos;")}' name='${questID}' ${options}></input>`;
      if (value2) return `<input type='text' aria-label='${value2.replace(/'/g, "&apos;")}' name='${questID}' ${options}></input><span>${value2}</span>`;

      return `<input type='text' aria-label='${questText.split('<br>')[0]}' name='${questID}' ${options}></input>`;
    }

    // replace |___| with a textarea...
    questText = questText.replace(/\|___\|((\w+)\|)?/g, fTextArea);
    function fTextArea(x1, y1, z1) {
      let elId = "";
      if (z1 == undefined) {
        elId = questID + "_ta";
      } else {
        elId = z1;
      }

      return `<label for="${elId}" class="sr-only"></label>
        <textarea id='${elId}' name='${elId}' style="resize:auto;" aria-label='Enter your response'></textarea>`;
    }

    // replace #YNP with Yes No input: `(1) Yes, (0) No, (99) Prefer not to answer`
    questText = questText.replace(
      /#YNP/g,
      `<div role="radiogroup" aria-labelledby="yesNoDontKnowLabel">
        <label id="yesNoDontKnowLabel" class="sr-only">Select "Yes," "No," or "Prefer not to answer" to answer the question.</label>
        <ul>
          <li class='response'>
            <input type='radio' id="${questID}_1" name="${questID}" value="yes">
            <label for='${questID}_1'>${i18n.yes}</label>
          </li>
          <li class='response'>
            <input type='radio' id="${questID}_0" name="${questID}" value="no">
            <label for='${questID}_0'>${i18n.no}</label>
          </li>
          <li class='response'>
            <input type='radio' id="${questID}_99" name="${questID}" value="prefer not to answer">
            <label for='${questID}_99'>${i18n.preferNotToAnswer}</label>
          </li>
        </ul>
      </div>
      `
    );

    // replace #YN with Yes No input: `(1) Yes, (0) No`

    questText = questText.replace(
      /#YN/g,
      `<div role="radiogroup" aria-labelledby="yesNoLabel">
        <div id="yesNoLabel" class="sr-only">Select "Yes" or "No" to answer the question.</div>
        <ul>
          <li class='response'>
            <input type='radio' id="${questID}_1" name="${questID}" value="yes">
            <label for='${questID}_1'>${i18n.yes}</label>
          </li>
          <li class='response'>
            <input type='radio' id="${questID}_0" name="${questID}" value="no">
            <label for='${questID}_0'>${i18n.no}</label>
          </li>
        </ul>
      </div>
      `
    );

    // replace [a-zXX] with a checkbox box...
    // handle CB/radio + TEXT + TEXTBOX + ARROW + Text...
    questText = questText.replace(
      /([\[\(])(\w+)(?::(\w+))?(?:\|([^\|]+?))?[\]\)]([^<\n]+)?(<(?:input|textarea).*?<\/(?:input|textarea)>)(?:\s*->\s*(\w+))/g,
      cb1
    );
    function cb1(
      completeMatch,
      bracket,
      cbValue,
      cbName,
      cbArgs,
      labelText,
      textBox,
      skipToId
    ) {
      let inputType = bracket == "[" ? "checkbox" : "radio";
      cbArgs = cbArgs ? cbArgs : "";

      // first look in the args for the name [v|name=lala], if not there,
      // look for cbName [v:name], otherwise use the question id.
      let name = cbArgs.match(/name=['"]?(\w+)['"]?/);
      if (!name) {
        name = cbName ? `name="${cbName}"` : `name="${questID}"`;
      }

      let id = cbArgs.match(/id=['"]?(\w+)/);
      // if the user does supply the id in the cbArgs, we add it to.
      // otherwise it is in the cbArgs...
      let forceId = "";
      if (id) {
        id = id[1];
      } else {
        id = cbName ? cbName : `${questID}_${cbValue}`;
        forceId = `id=${id}`;
      }

      let skipTo = skipToId ? `skipTo=${skipToId}` : "";
      let value = cbValue ? `value=${cbValue}` : "";
      let rv = `<li class='response'><input type='${inputType}' ${forceId} ${name} ${value} ${cbArgs} ${skipTo}><label for='${id}'>${labelText}${textBox}</label></li>`;
      return rv;
    }
    // SAME thing but this time with a textarea...


    //displayif with just texts
    // the : changes the standard span to a div.
    questText = questText.replace(/\|displayif=(.+?)(:)?\|(.*?)\|/g, fDisplayIf);
    function fDisplayIf(containsGroup, condition, nl, text) {
      condition = condition.replaceAll('\"', "\'");
      let tag = (nl) ? "div" : "span"
      return `<${tag} class='displayif' displayif="${condition}">${text}</${tag}>`;
    }

    //displaylist...
    questText = questText.replace(/\|(displayList\(.+?\))\s*(:)?\|/g, fDisplayList);
    function fDisplayList(all,args,nl) {
      args = args.replaceAll('\'', "\"");
      let tag = (nl) ? "div" : "span"
      return `<${tag} class='displayList' data-displayList-args='${args}'>${args}</${tag}>`;
    }

    // replace next question  < -> > with hidden...
    questText = questText.replace(
      /<\s*(?:\|if\s*=\s*([^|]+)\|)?\s*->\s*([A-Z_][A-Z0-9_#]*)\s*>/g,
      fHidden
    );
    function fHidden(containsGroup, ifArgs, skipTo) {
      ifArgs = ifArgs == undefined ? "" : ` if=${encodeURIComponent(ifArgs)}`;
      return `<input type='hidden'${ifArgs} id='${questID}_skipto_${skipTo}' name='${questID}' skipTo=${skipTo} checked>`;
    }

    // replace next question  < #NR -> > with hidden...
    questText = questText.replace(
      /<\s*#NR\s*->\s*([A-Z_][A-Z0-9_#]*)\s*>/g,
      "<input type='hidden' class='noresponse' id='" +
      questID +
      "_NR' name='" +
      questID +
      "' skipTo=$1 checked>"
    );

    // handle skips
    questText = questText.replace(
      /<input ([^>]*?)><\/input><label([^>]*?)>(.*?)\s*->\s*([^<\s]*?)\s*<\/label>/g,
      "<input $1 skipTo='$4'></input><label $2>$3</label>"
    );
    questText = questText.replace(
      /<textarea ([^>]*)><\/textarea>\s*->\s*([^\s<]+)/g,
      "<textarea $1 skipTo=$2 aria-label='Enter your response'></textarea>"
    );
    questText = questText.replace(/<\/div><br>/g, "</div>");

    // handle the back/next/reset buttons
    const hasInputfield = questText.includes('input');
    const questButtonsDiv = getButtonDiv(button_text_obj, hasInputfield, questID, endMatch, target);
    
    let rv = `
      <form class='question' id='${questID}' ${questOpts} ${questArgs} novalidate hardEdit='${hardBool}' softEdit='${softBool}'>
        <fieldset>
          ${questText}
        </fieldset>
        ${questButtonsDiv}
        <div class="spacePadding"></div>
      </form>`;
    
    return rv;
  });


  // handle the display if case...
  contents = contents.replace(
    /\[DISPLAY IF\s*([A-Z][A-Z0-9+]*)\s*=\s*\(([\w,\s]+)\)\s*\]\s*<div (.*?)>/g,
    "<div $3 showIfId='$1' values='$2'>"
  );

  //removing random &#x1f; unit separator chars
  contents = contents.replace(//g, "");

  return [contents, questName];
}

function ordinal(a, lang) {
  
    if (Number.isInteger(a)) {
      if (lang === "es") {
        return `${a}o`;
      }
      else {
        switch (a % 10) {
          case 1: return ((a % 100) == 11 ? `${a}th` : `${a}st`);
          case 2: return ((a % 100) == 12 ? `${a}th` : `${a}nd`);
          case 3: return ((a % 100) == 13 ? `${a}th` : `${a}rd`);
          default: return (`${a}th`)
        } 
      }
    }
    
    return "";
  }
  
  function unrollLoops(txt, language) {
    // all the questions in the loops...
    // each element in res is a loop in the questionnaire...
    let loopRegex = /<loop max=(\d+)\s*>(.*?)<\/loop>/gm;
    txt = txt.replace(/(?:\r\n|\r|\n)/g, "\xa9");
    let res = [...txt.matchAll(loopRegex)].map(function (x, indx) {
      return { cnt: x[1], txt: x[2], indx: indx + 1, orig: x[0] };
    });
  
    let idRegex = /\[([A-Z_][A-Z0-9_#]*)[?!]?(?:\|([^,\|\]]+)\|)?(,.*?)?\]/gm;
    let disIfRegex = /displayif=.*?\(([A-Z_][A-Z0-9_#]*),.*?\)/g;
    // we have an array of objects holding the text..
    // get all the ids...
    let cleanedText = res.map(function (x) {
      x.txt = x.txt.replace("firstquestion", `loopindx=${x.indx} firstquestion`);
      x.txt += "[_CONTINUE" + x.indx + ",displayif=setFalse(-1,#loop)]";
      x.txt = x.txt.replace(/->\s*_CONTINUE\b/g, "-> _CONTINUE" + x.indx);
      let ids = [...x.txt.matchAll(idRegex)].map((y) => ({
        label: y[0],
        id: y[1],
        indx: x.indx,
      }));
      let disIfIDs = [...x.txt.matchAll(disIfRegex)].map((disIfID) => ({
        label: disIfID[0],
        id: disIfID[1],
      }));
      disIfIDs = disIfIDs.map((x) => x.id);
      let newIds = ids.map((x) => x.id);
  
      // find all ids defined within the loop,
      // note: textboxes are an outlier that needs
      //       to be fixed.
      let idsInLoop = Array.from(x.txt.matchAll(/\|[\w\s=]*id=(\w+)|___\|\s*(\w+)|textbox:\s*(\w+)/g)).map(x => {
        return x[1] ? x[1] : (x[2] ? x[2] : x[3])
      })
  
      // combobox and radiobuttons may have been renamed...
      let rb_cb_regex = /(?:[\(\[])\d+:(.*?)[\,\)\]]/g
  
      // goto from 1-> max for human consumption... need <=
      let loopText = "";
      for (let loopIndx = 1; loopIndx <= x.cnt; loopIndx++) {
        let currentText = x.txt;
        // replace all instances of the question ids with id_#
        ids.map(
          (id) =>
          (currentText = currentText.replace(
            new RegExp("\\b" + id.id + "\\b(?!\#)", "g"),
            `${id.id}_${loopIndx}_${loopIndx}`
          ))
        );
        //replace all idsInLoop in the loop with {$id_$loopIndx}
        idsInLoop.forEach(id => {
          currentText = currentText.replace(new RegExp(`\\b${id}\\b`, "g"), `${id}_${loopIndx}_${loopIndx}`);
        })
  
        //replace all user-named combo and radio boxes
        currentText = currentText.replaceAll(rb_cb_regex,(all,g1)=>all.replace(g1,`${g1}_${loopIndx}`))
  
        currentText = currentText.replace(/\{##\}/g, `${ordinal(loopIndx, language)}`)
  
        ids.map(
          (id) => (currentText = currentText.replace(/#loop/g, "" + loopIndx))
        );
  
  
        // replace  _\d_\d#prev with _{$loopIndex-1}
        // we do it twice to match a previous bug..
        currentText = currentText.replace(/_\d+_\d+#prev/g, `_${loopIndx - 1}_${loopIndx - 1}`)
        loopText = loopText + "\n" + currentText;
      }
      loopText +=
        "[_CONTINUE" + x.indx + "_DONE" + ",displayif=setFalse(-1,#loop)]";
      return loopText;
    });
  
    for (let loopIndx = 0; loopIndx < cleanedText.length; loopIndx++) {
      txt = txt.replace(res[loopIndx].orig, cleanedText[loopIndx]);
    }
    txt = txt.replace(/\xa9/g, "\n");
  
    return txt;
  }