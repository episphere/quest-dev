import { evaluateCondition, moduleParams } from './questionnaire.js';
import { parseGrid } from './buildGrid.js';
import { translate } from './common.js';
import { getStateManager } from './stateManager.js';

const questionSeparatorRegex = /\[([A-Z_][A-Z0-9_#]*[?!]?)(?:\|([^,|\]]+)\|?)?(,.*?)?\](.*?)(?=$|\[[A-Z_]|<form)/gs;
const gridReplaceRegex = /\|grid(\!|\?)*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/g;
const idWithLoopSuffixRegex = /^([a-zA-Z0-9_]+?)(_?\d+_\d+)?$/;
const valueOrDefaultRegex = /valueOrDefault\(["']([a-zA-Z0-9_]+?)(_?\d+_\d+)?["'](.*)\)/g;
const elementIdRegex = /id=([^\s]+)/;
const embeddedHTMLQuestionIDRegex = /id="([^"]+)"/;

export class QuestionProcessor {
  constructor(markdown, precalculated_values, i18n) {
      this.i18n = i18n;                                   // Language settings
      this.buttonTextObj = {                              // Back/Reset/Next/Submit buttons
          back: i18n.backButton,
          reset: i18n.resetAnswerButton,
          next: i18n.nextButton,
          submit: i18n.submitSurveyButton
      };
      this.precalculated_values = precalculated_values;   // Pre-calculated form values (e.g. user name and current date)
      this.loopDataArr = [];                              // Array of loop data. Responsive to user input.
      this.gridQuestionsArr = [];                         // Array of grid question IDs, used for processing someSelected and noneSelected conditionals.
      this.questions = this.splitIntoQuestions(markdown); // Split and prepare questions
      this.processedQuestions = new Map();                // Cache of processed form elements
      this.currentQuestionIndex = 0;                      // Track the current question
      this.isProcessingComplete = false;                  // Mark when all questions are processed
  }

  setQuestName(markdown) {
    const questModuleNameRegExp = new RegExp(/{"name":"(\w*)"}/);
    markdown.replace(questModuleNameRegExp, (_, moduleID) => {
      moduleParams.questName = moduleID;
      return "";
    });
  }

  removeMarkdownComments(markdown) {
    return markdown.replace(/^\s*\/\/.*$/gm, '');
  }

  splitIntoQuestions(markdown) {
    const questionsArr = [];
    let match;

    // Set the questionnaire name
    this.setQuestName(markdown);

    // Remove comments from the markdown
    markdown = this.removeMarkdownComments(markdown);

    // Replace grids with placeholders and store grid content for later processing
    let gridPlaceholders = [];
    markdown = markdown.replace(gridReplaceRegex, (...args) => {
      const gridContent = parseGrid(...args, this.buttonTextObj);
      const placeholder = `<<GRID_PLACEHOLDER_${gridPlaceholders.length}>>`;
      gridPlaceholders.push(gridContent);
      return placeholder;
    });

    // TODO: consider unrolling after user has input the response that determines number of loops.
    // This would lighten the initial load considerably. Would need to handle insertions to the array.
    // Would also need to handle removing generated loop eles on back button click and/or change of the trigger response.
    // Current loop process unrolls all possible responses to n=loopMax (25).
    //markdown = markdown.replace(/<\/loop>/g, "</loop>\n[END_OF_LOOP] placeholder");
    markdown = unrollLoops(markdown, this.i18n.language);

    // Now we have the contents unpacked and the grid placeholders embedded:
    // Split it into an array of question objects, handling the grids along the way
    // Note: Everything must be parsed in markdown order since some questions have jump targets and others don't.
    while ((match = questionSeparatorRegex.exec(markdown)) !== null) {
      const questionContent = match[4].trim();
      const questionAndGridSegments = questionContent.split(/(<<GRID_PLACEHOLDER_\d+>>)/g).filter(part => part.trim() !== '');
      
      // If length === 1, no grid placeholders were found in the question content
      if (questionAndGridSegments.length === 1) {
        questionsArr.push({
          fullMatch: match[0],
          questionID: match[1],
          options: match[2] || '',
          args: match[3] || '',
          content: questionContent,
          formElement: null
        });
      // Else, handle the question content plus the grid placeholders, which are at the end of the parsed array
      } else {
        questionAndGridSegments.forEach((arrayItem) => {
          const gridPlaceholderMatch = arrayItem.match(/<<GRID_PLACEHOLDER_(\d+)>>/);
          if (gridPlaceholderMatch) {
            // Get the previously stored grid content
            const gridIndex = parseInt(gridPlaceholderMatch[1], 10);
            const gridContent = gridPlaceholders[gridIndex].trim();
            const match = gridContent.match(embeddedHTMLQuestionIDRegex);
            const questionID = match ? match[1] : '';

            this.gridQuestionsArr.push(questionID);

            // Add the grid to the questions array. The formElement is already processed.
            // Also add the grid ID to the gridQuestions array for processing someSelected and noneSelected conditionals.
            questionsArr.push({
              fullMatch: match[0],
              questionID: questionID,
              options: null,
              args: null,
              content: null,
              formElement: gridContent
            });

          } else {
            // Handle regular question content (the grid placeholder has been removed)
            questionsArr.push({
              fullMatch: match[0],
              questionID: match[1],
              options: match[2] || '',
              args: match[3] || '',
              content: arrayItem.trim(),
              formElement: null
            });
          }
        });
      }
    }
    
    console.log('QuestionsArr:', questionsArr);
    return questionsArr;
  }
  
  /**
   * Transform the HTML string from the markdown converter into an HTML element.
   * Execute legacy DOM manipulation to convert the string into an element.
   * @param {string} htmlString - The HTML string to convert.
   * @param {boolean} isFirstQuestion - boolean to determine if this is the first question. If true, remove the 'back' button.
   * @param {boolean} isLastQuestion - boolean to determine if this is the last question. If true, remove the 'next' button.
   * @param {number} index - The index of the question in the this.questions array.
   * @returns {HTMLElement} - The HTML question element (a form with response options).
   */
  convertHTMLStringToEle(htmlString, isFirstQuestion, isLastQuestion, index) {
    const template = document.createElement('template');
    template.innerHTML = htmlString.trim();

    const newQuestionEle = template.content.firstChild;

    // Add the loop data to the loopDataArr to support the exitLoop function.
    if (newQuestionEle.hasAttribute("loopmax") && newQuestionEle.hasAttribute("firstquestion") && newQuestionEle.getAttribute("firstquestion") == '1') {
      const appState = getStateManager();
      const loopMaxID = newQuestionEle.getAttribute("loopmax");
      const loopMaxResponse = parseInt(appState.findResponseValue(loopMaxID), 10);
      const questionIDMatch = newQuestionEle.id.match(idWithLoopSuffixRegex);
      const loopFirstQuestionID = questionIDMatch?.[1] || '';

      this.loopDataArr.push({
        locationIndex: index,
        loopMax: 25,
        loopMaxQuestionID: loopMaxID,
        loopMaxResponse: loopMaxResponse,
        loopFirstQuestionID: loopFirstQuestionID,
      });
    }

    // The rest of this function is legacy DOM manipulation. Caution on refactoring.
    // handle data-hidden elements
    [...newQuestionEle.querySelectorAll("[data-hidden]")].forEach((x) => {
      x.style.display = "none";
    });

    // validate confirm. If the confirm was used instead of data-confirm, fix it now
    [...newQuestionEle.querySelectorAll("[confirm]")].forEach((element) => {
      element.dataset.confirm = element.getAttribute("confirm")
      element.removeAttribute("confirm")
    });

    [...newQuestionEle.querySelectorAll("[data-confirm]")].forEach((element) => {
      if (!newQuestionEle.querySelector(`#${element.dataset.confirm}`)) {
        console.warn('TODO: TEST (this previously used document access): confirm element not found:', element.dataset.confirm);
        delete element.dataset.confirm
      }
      const otherElement = newQuestionEle.querySelector(`#${element.dataset.confirm}`);
      console.warn('TODO: TEST (this previously used document access): confirm element found:', otherElement);
      otherElement.dataset.conformationFor = element.id;
    });

    // enable all popovers...
    [...newQuestionEle.querySelectorAll('[data-bs-toggle="popover"]')].forEach(popoverTriggerEl => {
      new bootstrap.Popover(popoverTriggerEl);
    });

    // remove the first 'previous' button and the final 'next' button.
    if (isFirstQuestion) {
      newQuestionEle.querySelector(".previous").remove();
    } 
    if (isLastQuestion) {
      newQuestionEle.querySelector(".next").remove();
    }

    return newQuestionEle;
  }

  /**
   * Find a question from this.questions.
   * If no questionID is provided, return the next sequential question.
   * @param {string || undefined} questionID - The questionID to find, or undefined to get the next sequential question.
   * @param {boolean} isInitialLoad - If true, this is part of the startup routine. Set the question active.
   * @returns {HTMLElement} - The HTML element of the found question.
   */

  findQuestion(questionID, isInitialLoad = false) {
    if (!questionID) {
      return this.getNextSequentialQuestion();

    } else if (questionID.startsWith('_CONTINUE')) {
      return this.findNextIterationFirstQuestion(questionID);
    }

    const index = this.questions.findIndex(question => question.questionID.startsWith(questionID));
    if (index !== -1) {
      this.currentQuestionIndex = index;
      const foundQuestion = this.processQuestion(index);

      if (isInitialLoad) {
        return this.manageActiveQuestionClass(foundQuestion, null);
      }

      return foundQuestion;
    }

    console.error(`Error, findQuestion (question not found): ${moduleParams.questName}, question: ${questionID}`);
    return null;
  }

  getNextSequentialQuestion() {
    if (this.currentQuestionIndex + 1 < this.questions.length) {
      const previousQuestion = this.processQuestion(this.currentQuestionIndex - 1);

      this.currentQuestionIndex++;
      const currentQuestion = this.processQuestion(this.currentQuestionIndex);

      return this.manageActiveQuestionClass(currentQuestion, previousQuestion);
    }

    console.error(`Error, getNextSequentialQuestion (no next question to load): ${moduleParams.questName}, index: ${this.currentQuestionIndex}`);
    return null;
  }

  loadPreviousQuestion(previousQuestionID) {
    if (this.currentQuestionIndex > 0) {
        const questionToUnload = this.getCurrentQuestion();
        const questionToLoad = this.findQuestion(previousQuestionID);
        this.manageActiveQuestionClass(questionToLoad, questionToUnload);

        return questionToLoad;
    }

    console.error(`Error, loadPreviousQuestion (no previous question to load): ${moduleParams.questName}, question: ${previousQuestionID}`);
    return null;
  }

  loadNextQuestion(questionID) {
    if (this.currentQuestionIndex + 1 <= this.questions.length) {
      const questionToUnload = this.getCurrentQuestion();
      const questionToLoad = this.findQuestion(questionID);
      this.manageActiveQuestionClass(questionToLoad, questionToUnload);
      
      return questionToLoad;
    }

    console.error(`Error, loadNextQuestion (unhandled case): ${moduleParams.questName}, question: ${questionID}, index: ${this.currentQuestionIndex}, length: ${this.questions.length}`);
    return null;
  }

  getCurrentQuestion() {
    if (this.currentQuestionIndex < this.questions.length) {
        return this.processQuestion(this.currentQuestionIndex);
    }

    console.error(`Error, getCurrentQuestion (no current question to load): ${moduleParams.questName}, index: ${this.currentQuestionIndex}`);
    return null;
  }

  // preloadNextQuestions(count = 3) {
  //     for (let i = 1; i <= count && this.currentQuestionIndex + i < this.questions.length; i++) {
  //         this.processQuestion(this.currentQuestionIndex + i);
  //     }
  // }

  /**
   * Process a single question's markdown, add it to the cache, and return the HTML element.
   * @param {number} index - The index of the question to process from the this.questions array.
   * @returns {HTMLElement} - The HTML element of the processed question.
   */

  processQuestion(index) {
    if (this.processedQuestions.has(index)) {
      return this.processedQuestions.get(index);
    }

    const questionObj = this.questions[index];
    const isFirstQuestion = index === 0;
    const isLastQuestion = index === this.questions.length - 1;

    let questionElement;

    if (questionObj.formElement) {
      questionElement = this.convertHTMLStringToEle(questionObj.formElement, isFirstQuestion, isLastQuestion, index);
    } else {
      const processedHTMLString = this.convertToHTMLString(questionObj);
      questionElement = this.convertHTMLStringToEle(processedHTMLString, isFirstQuestion, isLastQuestion, index);
    }

    this.processedQuestions.set(index, questionElement);
    return questionElement;
  }

  processAllQuestions(startIndex = 0, stopIndex = this.questions.length) {
    console.log('PROCESS ALL QUESTIONS:', startIndex, stopIndex);
    for (let i = startIndex; i < stopIndex; i++) {
      this.processQuestion(i);
    }

    this.isProcessingComplete = true;
  }

  manageActiveQuestionClass(questionToLoad, questionToUnload) {
    if (!questionToLoad) {
      console.error('Error, manageActiveQuestionClass (no question to load):', questionToLoad, questionToUnload);
      return null;
    }
    console.log('MANAGE ACTIVE QUESTION CLASS:', questionToLoad, questionToUnload);
    if (questionToUnload) {
      questionToUnload.classList.remove('active');
    }
    questionToLoad.classList.add('active');

    return questionToLoad;
  }

  // Search the gridQuestionsArr for the elementID, then return the value of the input element.
  /**
   * Handle someSelected and noneSelected conditionals for grid questions.
   * Search the grid questions for the elementID (the specific radio or checkbox input element).
   * Return the value of the input element for comparison to the user's input.
   * @param {string} elementID - The ID of the radio or checkbox input element to find.
   * @returns {string} - The value of the input element, or null if not found.
   */
  findGridRadioCheckboxEle(elementID) {
    for (const questionID of this.gridQuestionsArr) {
      const questionElement = this.findQuestion(questionID);
      if (questionElement) {
        const radioOrCheckbox = questionElement.querySelector(`#${elementID}`);
        if (radioOrCheckbox) {
          return radioOrCheckbox?.value || null;
        }
      }
    }

    console.error(`Error, findGridInputElement (element not found): ${moduleParams.questName}, elementID: ${elementID}`);
    return null;
  }

  // Find the closest loop data prior to the current question index
  // If not found, user may be returning to the survey mid-loop. Process all questions up to the current index,
  // which will populate the loopDataArr with the correct loop data. Then try again.
  getLoopData() {
    const findLoopIndex = () => {
      return this.loopDataArr.findIndex((loop) => loop.locationIndex <= this.currentQuestionIndex);
    };

    let loopIndex = findLoopIndex();
    if (loopIndex === -1) {
      this.processAllQuestions(0, this.currentQuestionIndex);
      loopIndex = findLoopIndex();
    }

    return this.loopDataArr[loopIndex] || this.loopDataArr[this.loopDataArr.length - 1] || null;
  }

  findNextIterationFirstQuestion(questionID) {

    const loopIndexRegex = /_(\d+)_(\d+)$/;
    const loopIndexMatch = questionID.match(loopIndexRegex);
    if (!loopIndexMatch && loopIndexMatch[1] && loopIndexMatch[2]) {
      console.error(`Error, findQuestion (loop index not found): ${moduleParams.questName}, question: ${questionID}`);
      return null;
    }

    const loopIterationIndex = loopIndexMatch[1];
    const nextLoopIterationIndex = parseInt(loopIterationIndex, 10) + 1;

    const loopData = this.getLoopData();
    if (!loopData) {
      console.error(`Error, findQuestion (loop data not found): ${moduleParams.questName}, question: ${questionID}`);
      return null;
    }

    // If the next index is greater than the loopMaxResponse (or loopMax as a fallback), exit the loop.
    if (nextLoopIterationIndex > loopData.loopMaxResponse || nextLoopIterationIndex > loopData.loopMax) {
      return this.findEndOfLoop();

      // Else, find the first question for the next loop iteration.
    } else {
      const nextIterationFirstQuestionID = `${loopData.loopFirstQuestionID}_${nextLoopIterationIndex}_${nextLoopIterationIndex}`;
      console.log('TODO: TEST (is questionQueue managed correctly) NEXT ITERATION START ID:', nextIterationFirstQuestionID);

      return this.findQuestion(nextIterationFirstQuestionID);
    }
  }

  findEndOfLoop() {
    const endOfLoopIndex = this.questions.findIndex((question, index) => {
      return question.questionID === 'END_OF_LOOP' && index > this.currentQuestionIndex;
    });

    if (endOfLoopIndex === -1) {
      console.error(`Error, findEndOfLoop (no end of loop found): ${moduleParams.questName}, index: ${this.currentQuestionIndex}`);
      return null;
    }

    // End of loop found. It is a placeholder, so increment to access the first question after the loop.
    return this.processQuestion(endOfLoopIndex + 1);
  }

  replaceDateTags(content) {
    const replacements = [
        [/#currentMonthStr/g, this.i18n.months[this.precalculated_values.current_month_str]],
        [/#currentMonth/g, this.precalculated_values.current_month],
        [/#currentYear/g, this.precalculated_values.current_year],
        [/#today(\s*[+\-]\s*\d+)?/g, this.replaceTodayTag.bind(this)],
        [/#YNP/g, this.generateYesNoPrefer.bind(this)],
        [/#YN/g, this.generateYesNo.bind(this)]
    ];

    replacements.forEach(([regex, replacement]) => {
        content = content.replace(regex, replacement);
    });

    return content;
  }

  convertToHTMLString(question, i18n = this.i18n, precalculated_values = this.precalculated_values) {
    this.currentQuestion = question;
    let { questionID, options, args, content } = question;
    let questText = content;
    let questOpts = options;
    let questArgs = args;
    let questID = questionID;

    questText = this.replaceDateTags(questText);
    questText = questText
      //TODO: look here for the old version if spacing is off
      .replaceAll("\u001f", "\n")
      .replace(/(?:\r\n|\r|\n)/g, "<br>")
      .replace(/\[_#\]/g, "");
    let counter = 1;
    questText = questText.replace(/\[\]/g, function () {
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
      if (optional == null || optional === "") {
        optional = "";
      } else {
        optional = `optional='${encodeURIComponent(optional)}'`;
      }
      return `<span forId='${forId}' ${optional}>${forId}</span>`;
    }

    // replace {#id} with span tag
    questText=questText.replace(/\{\#([^}#]+)\}/g,fHash)
    function fHash(fullmatch,expr){
      return `<span data-encoded-expression=${encodeURIComponent(expr)}>${expr}</span>`
    }

    //adding displayif with nested questions. nested display if uses !| to |!
    questText = questText.replace(/!\|(displayif=.+?)\|(.*?)\|!/g, fDisplayIf);
    function fDisplayIf(containsGroup, condition, text) {
      text = text.replace(/\|(?:__\|){2,}(?:([^|<]+[^|]+)\|)?/g, fNum);
      text = text.replace(/\|popup\|([^|]+)\|(?:([^|]+)\|)?([^|]+)\|/g, fPopover);
      text = text.replace(/\|@\|(?:([^|<]+[^|]+)\|)?/g, fEmail);
      text = text.replace(/\|date\|(?:([^|<]+[^|]+)\|)?/g, fDate);
      text = text.replace(/\|tel\|(?:([^|<]+[^|]+)\|)?/g, fPhone);
      text = text.replace(/\|SSN\|(?:([^|<]+[^|]+)\|)?/g, fSSN);
      text = text.replace(/\|state\|(?:([^|<]+[^|]+)\|)?/g, fState);
      //text = text.replace(/\((\d*)(?::(\w+))?(?:\|(\w+))?(?:,(displayif=.+\))?)?\)(.*?)(?=(?:\(\d)|\n|<br>|$)/g, fRadio);
      text = text.replace(/\[(\d*)(\*)?(?::(\w+))?(?:\|(\w+))?(?:,(displayif=.+?\))?)?\]\s*(.*?)\s*(?=(?:\[\d)|\n|<br>|$)/g, fCheck);
      text = text.replace(/\[text\s?box(?:\s*:\s*(\w+))?\]/g, fTextBox);
      text = text.replace(/\|(?:__\|)(?:([^\s<][^|<]+[^\s<])\|)?\s*(.*?)/g, fText);
      text = text.replace(/\|___\|((\w+)\|)?/g, fTextArea);
      text = text.replace(/\|time\|(?:([^|<]+[^|]+)\|)?/g, fTime);
      text = text.replace(/#YNP/g, translate('yesNoPrefer')); //check
      text = questText.replace(/#YN/g, translate('yesNo')); //check

      // text = text.replace(/\|(?:__\|){2,}(?:([^\|\<]+[^\|]+)\|)?/g, fNum);
      // text = text.replace(/\|popup\|([^|]+)\|(?:([^|]+)\|)?([^|]+)\|/g, fPopover);
      // text = text.replace(/\|@\|(?:([^\|\<]+[^\|]+)\|)?/g, fEmail);
      // text = text.replace(/\|date\|(?:([^\|\<]+[^\|]+)\|)?/g, fDate);
      // text = text.replace(/\|tel\|(?:([^\|\<]+[^\|]+)\|)?/g, fPhone);
      // text = text.replace(/\|SSN\|(?:([^\|\<]+[^\|]+)\|)?/g, fSSN);
      // text = text.replace(/\|state\|(?:([^\|\<]+[^\|]+)\|)?/g, fState);
      // text = text.replace(/\((\d*)(?:\:(\w+))?(?:\|(\w+))?(?:,(displayif=.+\))?)?\)(.*?)(?=(?:\(\d)|\n|<br>|$)/g, fRadio);
      // text = text.replace(/\[(\d*)(\*)?(?:\:(\w+))?(?:\|(\w+))?(?:,(displayif=.+?\))?)?\]\s*(.*?)\s*(?=(?:\[\d)|\n|<br>|$)/g, fCheck);
      // text = text.replace(/\[text\s?box(?:\s*:\s*(\w+))?\]/g, fTextBox);
      // text = text.replace(/\|(?:__\|)(?:([^\s<][^|<]+[^\s<])\|)?\s*(.*?)/g, fText);
      // text = text.replace(/\|___\|((\w+)\|)?/g, fTextArea);
      // text = text.replace(/\|time\|(?:([^\|\<]+[^\|]+)\|)?/g, fTime);
      // text = text.replace(/#YNP/g, translate('yesNoPrefer')); //check
      // text = questText.replace(/#YN/g, translate('yesNo')); //check

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
    questText = questText.replace(/\|month\|(?:([^\|]+)\|)?/g, fMonth);

    // TODO: does this have the same DOM ID / input ID mismatch issue as month inputs (resolved in fMonth)? If yes, refactor to combine and use the fMonth approach.
    function fDate(fullmatch, opts) {
      let type = fullmatch.match(/[^|]+/);
      let { options, elementId } = guaranteeIdSet(opts, type);
      let optionObj = paramSplit(options);
      // can't have the value uri encoded... 
      if (Object.prototype.hasOwnProperty.call(optionObj, "value")) {
          optionObj.value = decodeURIComponent(optionObj.value);
      }
  
      options = reduceObj(optionObj);

      if (Object.prototype.hasOwnProperty.call(optionObj, "min")) {
        options = options + ` data-min-date-uneval=${optionObj.min}`
      }
      if (Object.prototype.hasOwnProperty.call(optionObj, "max")) {
        options = options + `  data-max-date-uneval=${optionObj.max}`
      }
      
      const descText = type === 'month' ? "Type month and four-digit year" : type === 'date' ? "Select a date" : "Enter the month and year in format: four digit year - two digit month. YYYY-MM";
  
      // Adding placeholders and aria-describedby attributes in one line
      options += ` placeholder='Select ${type}' aria-describedby='${elementId}-desc' aria-label='Select ${type}'`;
      return `<input type='${type}' ${options}><span id='${elementId}-desc' class='sr-only'>${descText}</span>`;
    }

    function fMonth(fullmatch, opts) {
      const type = fullmatch.match(/[^|]+/);
      const { options, elementId } = guaranteeIdSet(opts, type);
      const questIDPrefix = questID.match(idWithLoopSuffixRegex)[1];

      const updatedOptions = options.replace(valueOrDefaultRegex, (_, prefix, suffix, rest) => {
        return `valueOrDefault("${questIDPrefix}${suffix}"${rest})`;
      });

      const optionObj = paramSplit(updatedOptions);
      if (Object.prototype.hasOwnProperty.call(optionObj, "value")) {
          optionObj.value = decodeURIComponent(optionObj.value);
      }

      const unevaluatedDates = [];
      
      if (Object.prototype.hasOwnProperty.call(optionObj, "min")) {
        unevaluatedDates.push(`data-min-date-uneval=${optionObj.min}`);
      }

      if (Object.prototype.hasOwnProperty.call(optionObj, "max")) {
        unevaluatedDates.push(`data-max-date-uneval=${optionObj.max}`);
      }
  
      const descText = "Enter the month and year in format: four digit year - two digit month. YYYY-MM";
      const finalOptions = `${updatedOptions} ${unevaluatedDates.join(' ')} placeholder='Select month' aria-describedby='${elementId}-desc' aria-label='Select month'`;

      return `<input type='${type}' ${finalOptions}><span id='${elementId}-desc' class='sr-only'>${descText}</span>`;
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

    function guaranteeIdSet(options = "", inputType = "inp") {
      if (options) {
        options = options.trim();
      }

      let elementId = options.match(elementIdRegex);
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

    let buttonRegex = /\((\d+)(?:\:(\w+))?(?:\|(\w+))?(?:,displayif=([^)]*))?(\s*\))/;
    for (let match = questText.match(buttonRegex); !!match; match = questText.match(buttonRegex)) {
      questText = handleButton(match);
    }

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
      if (Object.prototype.hasOwnProperty.call(optionObj, "min")) {
        options = options + ` data-min="${optionObj.min}"`
      }
      if (Object.prototype.hasOwnProperty.call(optionObj, "max")) {
        options = options + ` data-max="${optionObj.max}"`
      }

      // Handle not converted and not yet calculated min and max values
      const minMaxValueTest = (value) => { return value && !value.startsWith('valueOr') && !value.includes('isDefined') && value !== '0' ? value : ''; }
      // Evaluate min and max, ensuring they are valid numbers or get evaluated if they aren't.
      const evaluateMinMax = (value) => {
        let result = minMaxValueTest(value);
        if (result && isNaN(result)) {
          result = evaluateCondition(result);
          if (isNaN(result)) result = '';  // Reset if still not a number after evaluation
        }
        return result;
      };

      // Process min and max values
      let min = evaluateMinMax(optionObj.min);
      let max = evaluateMinMax(optionObj.max);

      // Build the description text
      const descriptionText = `This field accepts numbers. Please enter a whole number ${min && max ? `between ${min} and ${max}` : ''}.`;
      const defaultPlaceholder = `placeholder="${moduleParams.i18n.enterValue}"`;

      // Use default placeholder when min to max range is a large distribution, e.g. max weight (999) and max age (125).
      // Same for min == 0. Show default placeholder for those cases.
      let placeholder;
      if (max && max > 100) {
        placeholder = defaultPlaceholder;
      } else if (min && max) {
        const avgValue = Math.floor((parseInt(min, 10) + parseInt(max, 10)) / 2);
        placeholder = `placeholder="${moduleParams.i18n.example}: ${avgValue}"`;
      } else {
        placeholder = defaultPlaceholder;
      }

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
    const questButtonsDiv = this.getButtonDiv(hasInputfield, questID, endMatch, target);
    
    let rv = `
      <form class='question' id='${questID}' ${questOpts} ${questArgs} novalidate hardEdit='${hardBool}' softEdit='${softBool}'>
        <fieldset>
          ${questText}
        </fieldset>
        ${questButtonsDiv}
        <div class="spacePadding"></div>
      </form>`;
    
    this.currentQuestion = null;

    return rv;
  }

  processInputs(content) {
    const inputReplacements = [
      { regex: /\|(?:__\|){2,}(?:([^\|\<]+[^\|]+)\|)?/g, handler: this.handleNumberInput.bind(this) },
      { regex: /\|(?:__\|)(?:([^\s<][^|<]+[^\s<])\|)?\s*(.*?)/g, handler: this.handleTextInput.bind(this) },
      { regex: /\|___\|((\w+)\|)?/g, handler: this.handleTextArea.bind(this) },
      { regex: /\|@\|(?:([^\|\<]+[^\|]+)\|)?/g, handler: this.handleEmailInput.bind(this) },
      { regex: /\|date\|(?:([^\|\<]+[^\|]+)\|)?/g, handler: this.handleDateInput.bind(this) },
      { regex: /\|tel\|(?:([^\|\<]+[^\|]+)\|)?/g, handler: this.handlePhoneInput.bind(this) },
      { regex: /\|SSN\|(?:([^\|\<]+[^\|]+)\|)?/g, handler: this.handleSSNInput.bind(this) },
      { regex: /\|state\|(?:([^\|\<]+[^\|]+)\|)?/g, handler: this.handleStateDropdown.bind(this) },
      { regex: /\((\d*)(?:\:(\w+))?(?:\|(\w+))?(?:,(displayif=.+\))?)?\)(.*?)(?=(?:\(\d)|\n|<br>|$)/g, handler: this.handleRadioButton.bind(this) },
      { regex: /\[(\d*)(\*)?(?:\:(\w+))?(?:\|(\w+))?(?:,(displayif=.+?\))?)?\]\s*(.*?)\s*(?=(?:\[\d)|\n|<br>|$)/g, handler: this.handleCheckbox.bind(this) }
    ];

    inputReplacements.forEach(({ regex, handler }) => {
      content = content.replace(regex, handler);
    });

    return content;
  }

  handleNumberInput(match, opts) {
    const { options, elementId } = this.guaranteeIdSet(opts, "num");
    return `<input type='number' aria-label='${elementId}' step='any' name='${elementId}' ${options}><br>`;
  }

  handleTextInput(match, opts, label) {
    const { options, elementId } = this.guaranteeIdSet(opts, "txt");
    return `<input type='text' aria-label='${label || elementId}' name='${elementId}' ${options}>`;
  }

  handleTextArea(match, fullMatch, id) {
    const elementId = id || `${this.currentQuestion.questionID}_ta`;
    return `<textarea id='${elementId}' name='${elementId}' aria-label='Enter your response'></textarea>`;
  }

  handleEmailInput(match, opts) {
    const { options, elementId } = this.guaranteeIdSet(opts, "email");
    return `<input type='email' ${options} placeholder="user@example.com">`;
  }

  handleDateInput(match, opts) {
    const { options, elementId } = this.guaranteeIdSet(opts, "date");
    return `<input type='date' ${options} aria-label='Select date'>`;
  }

  handlePhoneInput(match, opts) {
    const { options, elementId } = this.guaranteeIdSet(opts, "tel");
    return `<input type='tel' ${options} pattern="[0-9]{3}-?[0-9]{3}-?[0-9]{4}" maxlength="12" placeholder='###-###-####'>`;
  }

  handleSSNInput(match, opts) {
    const { options, elementId } = this.guaranteeIdSet(opts, "SSN");
    return `<input type='text' ${options} class="SSN" inputmode="numeric" maxlength="11" pattern="[0-9]{3}-?[0-9]{2}-?[0-9]{4}" placeholder="_ _ _-_ _-_ _ _ _">`;
  }

  handleStateDropdown(match, opts) {
    const { options, elementId } = this.guaranteeIdSet(opts, "state");
    const states = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];
    const stateOptions = states.map(state => `<option value='${state}'>${state}</option>`).join('');
    return `<select ${options}><option value='' disabled selected>${this.i18n.chooseState}: </option>${stateOptions}</select>`;
  }

  handleRadioAndCheckbox(content) {
    const buttonRegex = /\((\d+)(?:\:(\w+))?(?:\|(\w+))?(?:,displayif=([^)]*))?(\s*\))/;
    while (content.match(buttonRegex)) {
        content = content.replace(buttonRegex, this.handleRadioButton.bind(this));
  }

  content = content.replace(
      /\[(\d*)(\*)?(?:\:(\w+))?(?:\|(\w+))?(?:,(displayif\s*=\s*.+?\)\s*)?)?\]\s*(.*?)\s*(?=(?:\[\d)|\n|<br>|$)/g,
      this.handleCheckbox.bind(this)
  );

  return content;
  }

  // guaranteeIdSet(options, inputType = "inp") {
  //   if (options == undefined) {
  //     options = "";
  //   }
  //   options = options.trim();
  //   let elementId = options.match(/id=([^\s]+)/);
  //   if (!elementId) {
  //     elementId = `${this.currentQuestion.questionID}_${inputType}`;
  //     options = `${options} id=${elementId}`;
  //   } else {
  //     elementId = elementId[1];
  //   }
  //   return { options: options, elementId: elementId };
  // }

  replaceTodayTag(match, offset) {
    if (!offset || offset.trim().length == 0) {
      return this.precalculated_values.quest_format_date;
    }
    offset = parseInt(offset.replace(/\s/g, ""));
    let offset_date = new Date(this.precalculated_values.current_date);
    offset_date.setDate(this.precalculated_values.current_day + offset);
    return this.dateToQuestFormat(offset_date);
  }

  dateToQuestFormat(date) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  generateYesNoPrefer(questionID) {
    return `
      <div role="radiogroup" aria-labelledby="${questionID}_ynp_label">
        <label id="${questionID}_ynp_label" class="sr-only">Select "Yes," "No," or "Prefer not to answer" to answer the question.</label>
        <ul>
          <li class='response'><input type='radio' id="${questionID}_1" name="${questionID}" value="yes"><label for='${questionID}_1'>${this.i18n.yes}</label></li>
          <li class='response'><input type='radio' id="${questionID}_0" name="${questionID}" value="no"><label for='${questionID}_0'>${this.i18n.no}</label></li>
          <li class='response'><input type='radio' id="${questionID}_99" name="${questionID}" value="prefer not to answer"><label for='${questionID}_99'>${this.i18n.preferNotToAnswer}</label></li>
        </ul>
      </div>
    `;
  }

  generateYesNo(questionID) {
      return `
      <div role="radiogroup" aria-labelledby="${questionID}_yn_label">
          <div id="${questionID}_yn_label" class="sr-only">Select "Yes" or "No" to answer the question.</div>
          <ul>
          <li class='response'><input type='radio' id="${questionID}_1" name="${questionID}" value="yes"><label for='${questionID}_1'>${this.i18n.yes}</label></li>
          <li class='response'><input type='radio' id="${questionID}_0" name="${questionID}" value="no"><label for='${questionID}_0'>${this.i18n.no}</label></li>
          </ul>
      </div>
      `;
  }

  getButtonDiv(hasInputField, questID, endMatch, target) {
    const nextButton = endMatch
        ? ""
        : `<button type='submit' class='next w-100' ${target} aria-label='Next question' data-click-type='next'>${this.buttonTextObj.next}</button>`;
    
    const resetButton = (questID === 'END')
        ? `<button type='submit' class='reset' id='submitButton' aria-label='Submit your survey' data-click-type='submitSurvey'>${this.buttonTextObj.submit}</button>`
        : hasInputField
            ? `<button type='submit' class='reset w-100' aria-label='Reset this answer' data-click-type='reset'>${this.buttonTextObj.reset}</button>`
            : "";

    const prevButton = (endMatch && endMatch[1]) === "noback"
        ? ""
        : (questID === 'END')
            ? `<button type='submit' class='previous w-100' id='lastBackButton' aria-label='Back to the previous section' data-click-type='previous'>${this.buttonTextObj.back}</button>`
            : `<button type='submit' class='previous w-100' aria-label='Back to the previous question' data-click-type='previous'>${this.buttonTextObj.back}</button>`;

    return `
        <div class="py-0">
            <div class="row d-flex flex-column flex-md-row">
                <div class="col-md-3 col-sm-12 order-1 order-md-3">
                    ${nextButton}
                </div>
                <div class="col-md-6 col-sm-12 order-2">
                    ${resetButton}
                </div>
                <div class="col-md-3 col-sm-12 order-3 order-md-1">
                    ${prevButton}
                </div>
            </div>
        </div>`;
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
      // console.log('X:', x);
      // console.log('X0:', x[0]);
      // console.log('X1:', x[1]);
      // console.log('X2:', x[2]);
      // console.log('INDX:', indx);
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
      disIfIDs.map((x) => x.id);
      ids.map((x) => x.id);
  
      // find all ids defined within the loop,
      // note: textboxes are an outlier that needs to be fixed.
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
        ids.map((id) => (currentText = currentText.replace(
            new RegExp("\\b" + id.id + "\\b(?!\#)", "g"),
            `${id.id}_${loopIndx}_${loopIndx}`))
        );
        //replace all idsInLoop in the loop with {$id_$loopIndx}
        idsInLoop.forEach(id => {
          currentText = currentText.replace(new RegExp(`\\b${id}\\b`, "g"), `${id}_${loopIndx}_${loopIndx}`);
        })
  
        //replace all user-named combo and radio boxes
        currentText = currentText.replaceAll(rb_cb_regex,(all,g1)=>all.replace(g1,`${g1}_${loopIndx}`))
        currentText = currentText.replace(/\{##\}/g, `${ordinal(loopIndx, language)}`)
  
        ids.map(() => (currentText = currentText.replace(/#loop/g, "" + loopIndx)));
  
        // replace  _\d_\d#prev with _{$loopIndex-1}
        // we do it twice to match a previous bug..
        currentText = currentText.replace(/_\d+_\d+#prev/g, `_${loopIndx - 1}_${loopIndx - 1}`)
        loopText = loopText + "\n" + currentText;
      }

      loopText += "[_CONTINUE" + x.indx + "_DONE" + ",displayif=setFalse(-1,#loop)]";
      loopText += "[END_OF_LOOP] placeholder";
      return loopText;
    });
  
    for (let loopIndx = 0; loopIndx < cleanedText.length; loopIndx++) {
      txt = txt.replace(res[loopIndx].orig, cleanedText[loopIndx].replace('</loop>', '[END_OF_LOOP]'));
    }

    txt = txt.replace(/\xa9/g, "\n");
  
    return txt;
  }