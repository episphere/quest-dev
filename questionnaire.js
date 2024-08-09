import { Tree } from "./tree.js";
import { knownFunctions } from "./knownFunctions.js";
import { validateInput, validationError } from "./validate.js"
import { translate } from "./common.js";
import { math } from './customMathJSImplementation.js';
import { restoreResponses } from "./restoreResponses.js";
import { getStateManager } from "./stateManager.js";
export const moduleParams = {};

// TODO: break this up into more tightly related files

// The questionQueue is an Tree which contains
// the question ids in the order they should be displayed.
export const questionQueue = new Tree(); // TODO: rename to questionTree for future clarity

export function isFirstQuestion() {
  return questionQueue.isEmpty() || questionQueue.isFirst();
}

/**
 * Determine the storage format for the response data.
 * Grid questions are stored as objects. Ensure each key is stored with the response.
 * Single response (radio) input questions are stored as primitives.
 * Multi-selection (checkbox) input questions are stored as arrays.
 * @param {HTMLElement} form - the form element being evaluated.
 * @returns {number} - the number of response keys.
 */

//TODO: test for grid questions
function getNumResponseInputs(form) {
  const responseInputs = new Set();

  form.querySelectorAll("input, textarea, select").forEach((current) => {
    if (current.type !== "submit" && current.type !== "hidden") {
      if (["radio", "checkbox"].includes(current.type)) {
        responseInputs.add(current.name);
      } else {
        responseInputs.add(current.id);
      }
    }
  });

  // Cache the number of response keys for the form so it doesn't re-evaluate every keystroke.
  const appState = getStateManager();
  appState.setNumResponseKeys(form.id, responseInputs.size);
  appState.clearOtherResponseKeys(form.id);
  return responseInputs.size;
}

/**
 * Update the state manager with the response value(s).
 * @param {HTMLElement} form - the form element being evaluated (the active survey quesiton).
 * @param {string} value - the response value.
 * @param {string} id - the response id.
 * @returns {void} - sets the response value in the state manager.
 */

function setResponsesInState(form, value, id) {
  const appState = getStateManager();
  const numResponses = appState?.getNumResponseKeys(form.id) || getNumResponseInputs(form);
  
  // Validate and sanitize inputs.
  if (!id || id.trim() === "") return;

  // Normalize value to undefined if it is an empty string or an empty array.
  // This is necessary to ensure that the value is removed from the store.
  if (value === "" || (Array.isArray(value) && value.length === 0)) {
    value = undefined;
  }

  switch (numResponses) {
    case 0:
      break;

    default:
      if (value === undefined || value === null) {
        appState.removeResponseItem(form.id, id, numResponses);
      } else {
        appState.setResponse(form.id, id, numResponses, value);
      }
      break;
  }
}

export function parseSSN(event) {
  if (event.type == "keyup") {
    let element = event.target;
    let val = element.value.replace(/\D/g, "");
    let newVal = "";

    if (val.length >= 3 && val.length < 5 && event.code != "Backspace") {
      //reformat and return SSN
      newVal += val.replace(/(\d{3})/, "$1-");
      element.value = newVal;
    }

    if (val.length >= 5 && event.code != "Backspace") {
      //reformat and return SSN
      newVal += val.replace(/(\d{3})(\d{2})/, "$1-$2-");
      element.value = newVal;
    }
    return null;
  }
}

export function parsePhoneNumber(event) {
  if (event.type == "keyup") {
    let element = event.target;
    let phone = element.value.replace(/\D/g, "");
    let newVal = "";

    if (phone.length >= 3 && phone.length < 6 && event.code != "Backspace") {
      //reformat and return phone number
      newVal += phone.replace(/(\d{3})/, "$1-");
      element.value = newVal;
    }

    if (phone.length >= 6 && event.code != "Backspace") {
      //reformat and return phone number
      newVal += phone.replace(/(\d{3})(\d{3})/, "$1-$2-");
      element.value = newVal;
    }

    return null;
  }
}

export function callExchangeValues(nextElement) {
  exchangeValue(nextElement, "min", "data-min");
  exchangeValue(nextElement, "max", "data-max")
  exchangeValue(nextElement, "minval", "data-min");
  exchangeValue(nextElement, "maxval", "data-max")
  exchangeValue(nextElement, "data-min", "data-min")
  exchangeValue(nextElement, "data-max", "data-max");
}

function exchangeValue(element, attrName, newAttrName) {
  let attr = element.getAttribute(attrName)?.trim();

  // !!! DONT EVALUATE 2020-01 to 2019
  // !!! DONT EVALUATE 2023-07-19-to 1997
  // may have to do this for dates too.  <- yeah, had to!
  // Firefox and Safari for MacOS think <input type="month"> has type="text"...
  // so month selection calendar is not shown.
  if ( (element.getAttribute("type") == "month" && /^\d{4}-\d{1,2}$/.test(attr)) || 
       (element.getAttribute("type") == "date" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(attr)) ){
    
    // if leading zero for single digit month was stripped by the browser, add it back.
    if (element.getAttribute("type") == "month" && /^\d{4}-\d$/.test(attr)) {
      attr = attr.replace(/-(\d)$/, '-0$1')
    }
    
    element.setAttribute(newAttrName, attr)
    return element;
  }

  if (attr) {
    let isnum = /^[\d\.]+$/.test(attr);
    if (!isnum) {
      let tmpVal = evaluateCondition(attr);
      // note: tmpVal==tmpVal means that tmpVal is Not Nan
      if (tmpVal == undefined || tmpVal == null || tmpVal != tmpVal) {
        const previousResultsErrorMessage = moduleParams.previousResults && typeof moduleParams.previousResults === 'object' && Object.keys(moduleParams.previousResults)?.length === 0 && attr.includes('isDefined')
          ? `\nUsing the Markup Renderer?\nEnsure your variables are added to Settings -> Previous Results in JSON format.\nEx: {"AGE": "45"}`
          : '';
        console.error(`Module Coding Error: Evaluating ${element.id}:${attrName} expression ${attr}  => ${tmpVal} ${previousResultsErrorMessage}`)
        validationError(element, `Module Coding Error: ${element.id}:${attrName} ${previousResultsErrorMessage}`)
        return
      }
      //console.log('------------exchanged Vals-----------------')
      //console.log(`${element}, ${attrName}, ${newAttrName}, ${tmpVal}`)
      element.setAttribute(newAttrName, tmpVal);
    } else {
      element.setAttribute(newAttrName, attr);
    }
  }
  return element;
}

// TODO: Look here for Safari text input delay issue.
export function textboxinput(inputElement, validate = true) {

  let evalBool = "";
  const modalElement = document.getElementById('softModalResponse');
  if (!modalElement.classList.contains('show')) {
  
    const modal = new bootstrap.Modal(modalElement);

    if (inputElement.getAttribute("modalif") && inputElement.value != "") {
      evalBool = math.evaluate(
        decodeURIComponent(inputElement.getAttribute("modalif").replace(/value/, inputElement.value))
      );
    }

    if (inputElement.getAttribute("softedit") == "true" && evalBool == true) {
      if (inputElement.getAttribute("modalvalue")) {
        document.getElementById("modalResponseBody").innerText = decodeURIComponent(inputElement.getAttribute("modalvalue"));

        modal.show();
      }
    }
  }

  if (inputElement.className == "SSN") {
    // handles SSN auto-format
    parseSSN(inputElement);
  }

  if (['text', 'number', 'email', 'tel', 'date', 'month', 'time'].includes(inputElement.type)) {
    if (validate) {
      validateInput(inputElement)
    }
  }

  // BUG 423: radio button not changing value
  let radioWithText = inputElement.closest(".response")?.querySelector("input[type='radio']")
  if (radioWithText && inputElement.value?.trim() !== ''){
    radioWithText.click()
    radioAndCheckboxUpdate(radioWithText)
  }

  clearSelection(inputElement);
  const id = inputElement.id
  const value = handleXOR(inputElement) || inputElement.value;
  setResponsesInState(inputElement.form, value, id);
}

// onInput/Change handler for radio/checkboxes
// TODO: optimize this flow
export function rbAndCbClick(event) {
  const inputElement = event.target;
  // when we programatically click, the input element is null.
  // however we call radioAndCheckboxUpdate directly..
  if (inputElement) {
    validateInput(inputElement)
    radioAndCheckboxUpdate(inputElement);
    radioAndCheckboxClearTextInput(inputElement);
  }
}


// If radio/checkboxes have input fields, only enable input fields when they are selected
// Get all responses that have an input text box (can be number, date, etc., not radio/checkbox)
// If the checkbox is not selected, disable it and clear the value.
// Note: things that can go wrong: if a response has more than one text box.
export function radioAndCheckboxClearTextInput(inputElement) {
  
  const responses = [...inputElement.form.querySelectorAll(".response")].filter(response => {
    const textBox = response.querySelector("input:not([type=radio]):not([type=checkbox])")
    const checkbox = response.querySelector("input[type=checkbox],input[type=radio]");
    return textBox && checkbox;
  });
  
  responses.forEach(response => {
    const textBox = response.querySelector("input:not([type=radio]):not([type=checkbox])")
    const radioOrCheckbox = response.querySelector("input[type=radio],input[type=checkbox]")

    if (textBox && radioOrCheckbox && !radioOrCheckbox.checked) {
      textBox.value = ""
      const formID = inputElement.form.id;
      const inputID = textBox.id;

      if (formID && inputID) {
        const appState = getStateManager();
        appState.removeResponseItem(formID, inputID, appState.getNumResponseKeys(formID));
      }
    }
  });
}

export function radioAndCheckboxUpdate(inputElement) {
  if (!inputElement) return;
  clearSelection(inputElement);

  let selectedValue;

  if (inputElement.type == "checkbox") {
    // get all checkboxes with the same name attribute...
    selectedValue = Array.from(inputElement.form.querySelectorAll(`input[type = "checkbox"][name = ${inputElement.name}]`))
      .filter((x) => x.checked)
      .map((x) => x.value);
  } else {
    // we have a radio button..  just get the selected value...
    selectedValue = inputElement.value;
  }

  setResponsesInState(inputElement.form, selectedValue, inputElement.name);
}

function clearSelection(inputElement) {
  if (!inputElement.form || !inputElement.name) return;
  const sameNameEles = [...inputElement.form.querySelectorAll(`input[name = ${inputElement.name}],input[name = ${inputElement.name}] + label > input`)].filter((x) => x.type != "hidden");
  if (!sameNameEles) return;

  const appState = getStateManager();

   
  // If this is a "none of the above", go through all elements with the same name and mark them as "false" or clear the text values.
  if (inputElement.dataset.reset) {
    sameNameEles.forEach((element) => {

      switch (element.type) {
        case "checkbox":
          element.checked = element == inputElement ? element.checked : false;
          break;

        case "radio":
          break;

        default:
          element.value = element == inputElement ? inputElement.value : "";
          setResponsesInState(element.form, element.value, element.id);
          if (element.nextElementSibling && element.nextElementSibling.children.length !== 0) element.nextElementSibling.children[0].innerText = "";
          element.form.classList.remove("invalid");
          appState.removeResponseItem(element.form.id, element.id, appState.getNumResponseKeys(element.form.id));
          break;
      }
    });
  } else {
    // otherwise if this as another element with the same name and is marked as "none of the above" clear that.
    // don't clear everything though because you are allowed to have multiple choices.
    sameNameEles.forEach((element) => {
      if (element.dataset.reset) {
        element.checked = false

        //removing specifically the reset value from the array of checkboxes checked and removing from forms.value
        const key1 = element.name;
        const elementValue = element.value;
        const vals = appState.getItem(inputElement.form.id) ?? {};
        if (vals.hasOwnProperty(key1) && Array.isArray(vals[key1])) {
          console.warn("TODO: Unhandled transition to state mgr. test with 'none of the above' checkbox question.");
          let index = vals[key1].indexOf(elementValue)
          if (index !== -1) {
            vals[key1].splice(index, 1)
          }
          if (vals[key1].length === 0) {
            delete vals[key1]
          }
        }
      }
    });
  }
}

export function handleXOR(inputElement) {
  if (!inputElement.hasAttribute("xor")) {
    return inputElement.value;
  }

  // if the user tabbed through the xor, Dont clear anything
  if (!["checkbox", "radio"].includes(inputElement.type) && inputElement.value.length == 0) {
    return null;
  }
  
  const appState = getStateManager();
  const siblings = getXORSiblings(inputElement);
  siblings.forEach((sibling) => {
    appState.removeResponseItem(inputElement.form.id, sibling.id, appState.getNumResponseKeys(inputElement.form.id));
    resetSiblingDOMValues(sibling);
  });

  return inputElement.value;
}

function getXORSiblings(inputElement) {
  return [...inputElement.parentElement.querySelectorAll("input")].filter(sibling => 
    sibling.id !== inputElement.id &&
    sibling.hasAttribute("xor") &&
    sibling.getAttribute("xor") === inputElement.getAttribute("xor")
  );
}

function resetSiblingDOMValues(sibling) {
  if (["checkbox", "radio"].includes(sibling.type)) {
    sibling.checked = sibling.dataset.reset ? false : sibling.checked;
  } else {
    sibling.value = "";
    clearXORValidationMessage(sibling);
  }
}

function clearXORValidationMessage(inputElement) {
  const messageSpan = inputElement.nextElementSibling?.children[0];
  if (messageSpan?.tagName === "SPAN" && messageSpan.innerText.length !== 0) {
    messageSpan.innerText = "";
    inputElement.classList.remove("invalid");
    inputElement.form.classList.remove('invalid');
    inputElement.nextElementSibling.remove();
  }
}

export async function nextClick(norp) {
  // Because next button does not have ID, modal will pass-in ID of question
  // norp needs to be next button element
  if (typeof norp == "string") {
    norp = document.getElementById(norp).querySelector(".next");
  }

  // check that each required element is set...
  norp.form.querySelectorAll("[data-required]").forEach((elm) => {
    validateInput(elm)
  });

  await analyzeFormResponses(norp);
}

function showUnansweredQuestionsModal(num, norp, soft) {
  const prompt = translate("basePrompt", [num > 1 ? "are" : "is", num, num > 1 ? "s" : ""]);
  
  const modalID = soft ? 'softModal' : 'hardModal';
  const modal = new bootstrap.Modal(document.getElementById(modalID));
  const softModalText = translate("softPrompt");
  const hardModalText = translate("hardPrompt", [num > 1 ? "s" : ""]);

  const modalBodyTextId = soft ? "modalBodyText" : "hardModalBodyText";
  const modalBodyTextEle = document.getElementById(modalBodyTextId);
  
  modalBodyTextEle.innerText = `${prompt} ${soft ? softModalText : hardModalText}`;
  modalBodyTextEle.setAttribute('tabindex', '0');
  modalBodyTextEle.setAttribute('role', 'alert');

  if (soft) {
    const continueButton = document.getElementById("modalContinueButton");
    continueButton.removeEventListener("click", continueButton.clickHandler);
    //await the store operation on 'continue without answering' click for correct screen reader focus
    continueButton.clickHandler = async () => {
      await nextPage(norp);
    };
    continueButton.addEventListener("click", continueButton.clickHandler);
  }

  modal.show();

  // Set focus to the modal title
  document.getElementById("softModalTitle").focus();

  let modalElement = modal._element;
  modalElement.querySelector('.close').addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      modal.hide();
    }
  });
}

async function analyzeFormResponses(norp) {
  if (norp.form.getAttribute("softedit") == "true" || norp.form.getAttribute("hardedit") == "true") {
    // Fieldset is the parent of the inputs for all but grid questions. Grid questions are in a table.
    const fieldset = norp.form.querySelector('fieldset') || norp.form.querySelector('tbody');

    let numBlankResponses = [...fieldset.children]
      .filter(x => 
        x.tagName !== 'DIV' && x.tagName !== 'BR' &&
        x.type && x.type !== 'hidden' &&
        x.value !== undefined &&
        (x.style ? x.style.display !== "none" : true) &&
        !x.hasAttribute("xor")
      ).reduce((t, x) =>
        x.value.length == 0 ? t + 1 : t, 0
      );
      
    let hasNoResponses = getSelectedResponses(fieldset).filter((x) => x.type !== "hidden").length === 0;

    if (fieldset.hasAttribute("radioCheckboxAndInput")) {
      if (!radioCbHasAllAnswers(fieldset)) {
        hasNoResponses = true;
      }
    }

    if (norp.form.dataset.grid) {
      if (!gridHasAllAnswers(fieldset)) {
        hasNoResponses = true;
      }
      numBlankResponses = numberOfUnansweredGridQuestions(fieldset);
    }

    if (numBlankResponses == 0 && hasNoResponses == true) {
      numBlankResponses = 1;
    } else if ((numBlankResponses == 0) == true && hasNoResponses == false) {
      numBlankResponses = 0;
    } else if ((numBlankResponses == 0) == false && hasNoResponses == true) {
      numBlankResponses = numBlankResponses;
    } else {
      numBlankResponses = 0;
    }

    if (numBlankResponses > 0) {
      showUnansweredQuestionsModal(numBlankResponses, norp, norp.form.getAttribute("softedit") == "true");
      return null;
    }
  }
  await nextPage(norp);
}

function getNextQuestionId(currentFormElement) {
  // get the next question from the questionQueue
  // if it exists... otherwise get the next look at the
  // markdown and get the question follows.
  let nextQuestionNode = questionQueue.next();
  if (nextQuestionNode.done) {
    // We are at the end of the question queue...
    // get the next element from the markdown...
    let tmp = currentFormElement.nextElementSibling;
    // we are at a question that should be displayed add it to the queue and
    // make it the current node.
    questionQueue.add(tmp.id);
    nextQuestionNode = questionQueue.next();
  }

  return nextQuestionNode.value;
}

// TODO: move these to a separate file
export function showLoadingIndicator() {
    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = 'loadingIndicator';
    loadingIndicator.innerHTML = '<div class="spinner"></div>';
    document.body.appendChild(loadingIndicator);
}

export function hideLoadingIndicator() {
  const loadingIndicator = document.getElementById('loadingIndicator');
  if (loadingIndicator) {
    document.body.removeChild(loadingIndicator);
  }
}

// norp == next or previous button (which ever is clicked...)
async function nextPage(norp) {
  // The root is defined as null, so if the question is not the same as the
  // current value in the questionQueue. Add it.  Only the root should be effected.
  // NOTE: if the root has no children, add the current question to the queue
  // and call next().

  const appState = getStateManager();
  await appState.syncToStore();

  const questionElement = norp.form;
  questionElement.querySelectorAll("[data-hidden]").forEach((x) => {
    x.value = "true"
    setResponsesInState(questionElement, x.value, x.id)
  });

  if (checkValid(questionElement) == false) {
    return null;
  }

  if (questionQueue.isEmpty()) {
    questionQueue.add(questionElement.id);
    questionQueue.next();
  }

  // check if we need to add questions to the question queue
  checkForSkips(questionElement);

  let nextQuestionId = getNextQuestionId(questionElement);
  // get the actual HTML element.
  let nextElement = document.getElementById(nextQuestionId.value);
  nextElement = exitLoop(nextElement);

  // before we add the next question to the queue...
  // check for the displayif status...
  while (nextElement?.hasAttribute("displayif")) {
    // not sure what to do if the next element is is not a question ...
    if (nextElement.classList.contains("question")) {
      let display = evaluateCondition(nextElement.getAttribute("displayif"));
      if (display) break;
      if (nextElement.id.substring(0, 9) != "_CONTINUE") questionQueue.pop();

      let nextQuestionId = nextElement.dataset.nodisplay_skip;
      if (nextElement.dataset.nodisplay_skip) {
        questionQueue.add(nextElement.dataset.nodisplay_skip);
      }
      nextQuestionId = getNextQuestionId(nextElement);

      nextElement = document.getElementById(nextQuestionId.value);
      nextElement = exitLoop(nextElement);
    } else {
      console.error(" ============= next element is not a question...  not sure what went wrong...");
      console.trace();
    }
  }

  //hide the current question
  questionElement.classList.remove("active");

  displayQuestion(nextElement);
  window.scrollTo(0, 0);
}

function exitLoop(nextElement) {
  if (!nextElement) {
    console.error("nextElement is null or undefined");
    return null;
  }

  if (nextElement.hasAttribute("firstquestion")) {
    let loopMaxElement = document.getElementById(nextElement.getAttribute("loopmax"));
    if (!loopMaxElement) {
      console.error(`LoopMaxElement is null or undefined for ${nextElement.id}`);
      return nextElement;
    }

    let loopMax = parseInt(loopMaxElement.value);
    let firstQuestion = parseInt(nextElement.getAttribute("firstquestion"));
    let loopIndex = parseInt(nextElement.getAttribute("loopindx"));

    if (isNaN(loopMax) || isNaN(firstQuestion) || isNaN(loopIndex)) {
      console.error(`LoopMax, firstQuestion, or loopIndex is NaN for ${nextElement.id}: loopMax=${loopMax}, firstQuestion=${firstQuestion}, loopIndex=${loopIndex}`);
      return nextElement;
    }

    if (math.evaluate(firstQuestion > loopMax)) {
      questionQueue.pop();
      questionQueue.add(`_CONTINUE${loopIndex}_DONE`);
      let nextQuestionId = questionQueue.next().value;
      nextElement = document.getElementById(nextQuestionId.value);
    }
  }
  
  return nextElement;
}

// Manage the text builder for screen readers (only build when necessary)
let questionFocusSet;

export function displayQuestion(nextElement) {
  // Fail gently in the renderer tool.
  if (!nextElement && !moduleParams.renderObj.activate) return;
  
  questionFocusSet = false;

  [...nextElement.querySelectorAll("span[forid]")].forEach((x) => {
    let defaultValue = x.getAttribute("optional")
    x.innerHTML = math.valueOrDefault(decodeURIComponent(x.getAttribute("forid")), defaultValue)
  });

  [...nextElement.querySelectorAll("input[data-max-validation-dependency]")].forEach((x) =>
      (x.max = document.getElementById(x.dataset.maxValidationDependency).value));

  [...nextElement.querySelectorAll("input[data-min-validation-dependency]")].forEach((x) =>
      (x.min = document.getElementById(x.dataset.minValidationDependency).value));

  // check all responses for next question
  [...nextElement.querySelectorAll('[displayif]')].forEach((elm) => {
    let f = evaluateCondition(elm.getAttribute("displayif"));
    elm.style.display = f ? null : "none";
  });

  // check for displayif spans...
  [...nextElement.querySelectorAll("span[displayif],div[displayif]")].forEach(elm => {
      let f = evaluateCondition(elm.getAttribute("displayif"));
      elm.style.display = f ? null : "none";
    });

  [...nextElement.querySelectorAll("span[data-encoded-expression]")].forEach(elm=>{
      let f = evaluateCondition(decodeURIComponent(elm.dataset.encodedExpression))
      elm.innerText=f;
  });

  //Sets the brs after non-displays to not show as well
  [...nextElement.querySelectorAll(`[style*="display: none"]+br`)].forEach((e) => {
    e.style = "display: none"
  });
  
  // Add aria-hidden to all remaining br elements. This keeps the screen reader from reading them as 'Empty Group'.
  [...nextElement.querySelectorAll("br")].forEach((br) => {
    br.setAttribute("aria-hidden", "true");
  });

  // ISSUE: 403
  // update {$e:}/{$u} and and {$} elements in grids when the user displays the question ...
  [...nextElement.querySelectorAll("[data-gridreplace]")].forEach((e) => {
    if (e.dataset.gridreplacetype == "_val") {
      e.innerText = math._value(decodeURIComponent(e.dataset.gridreplace))
    } else {
      e.innerText = math.evaluate(decodeURIComponent(e.dataset.gridreplace))
    }
  });
  
  // Check if grid elements need to be shown. Elm is a <tr>. If f !== true, remove the row (elm) from the DOM.
  [...nextElement.querySelectorAll("[data-gridrow][data-displayif]")].forEach((elm) => {
    const f = evaluateCondition(decodeURIComponent(elm.dataset.displayif));
    console.log(`checking the datagrid for displayif... ${elm.dataset.questionId} ${f}`)
    if (f !== true) {
      elm.dataset.hidden = "true";
      elm.style.display = "none";
    } else {
      delete elm.dataset.hidden;
      elm.style.display = "";
    }
  });

  //Replacing all default HTML form validations with datasets
  [...nextElement.querySelectorAll("input[required]")].forEach((element) => {
    if (element.hasAttribute("required")) {
      element.removeAttribute("required");
      element.dataset.required = "true";
    }
  });

  [...nextElement.querySelectorAll("input[min]")].forEach((element) => {
    exchangeValue(element, "min", "data-min");
  });
  [...nextElement.querySelectorAll("input[max]")].forEach((element) =>
    exchangeValue(element, "max", "data-max")
  );
  // supporting legacy code... dont use minval
  [...nextElement.querySelectorAll("input[minval]")].forEach((element) => {
    exchangeValue(element, "minval", "data-min");
  });
  [...nextElement.querySelectorAll("input[maxval]")].forEach((element) =>
    exchangeValue(element, "maxval", "data-max")
  );

  [...nextElement.querySelectorAll("input[data-min]")].forEach((element) =>
    exchangeValue(element, "data-min", "data-min")
  );
  [...nextElement.querySelectorAll("input[data-max]")].forEach((element) => {
    exchangeValue(element, "data-max", "data-max");
  });

  // rewrite the data-(min|max)-date-uneval with a calulated value
  [...nextElement.querySelectorAll("input[data-min-date-uneval]")].forEach((element) => {
    exchangeValue(element, "data-min-date-uneval", "data-min-date");
    exchangeValue(element, "data-min-date-uneval", "min");
  });

  [...nextElement.querySelectorAll("input[data-max-date-uneval]")].forEach((element) => {
    exchangeValue(element, "data-max-date-uneval", "data-max-date");
    exchangeValue(element, "data-max-date-uneval", "max");
  });

  nextElement.querySelectorAll("[data-displaylist-args]").forEach(element => {
    console.log(element)
    element.innerHTML = math.existingValues(element.dataset.displaylistArgs)
  });

  // handle unsupported 'month' input type (Safari for MacOS and Firefox)
  const monthInputs = nextElement.querySelectorAll("input[type='month']");
  if (monthInputs.length > 0 && !isMonthInputSupported()) {
    monthInputs.forEach(input => {
      input.setAttribute('placeholder', 'YYYY-MM');
    });
  }

  //move to the next question...
  nextElement.classList.add("active");

  // JAWS (Windows) requires tabindex to be set on the response divs for the radio buttons to be accessible.
  // The tabindex leads to a negative user experience in VoiceOver (macOS).
  if (moduleParams.isWindowsEnvironment) {
    [...nextElement.querySelectorAll("div.response")].forEach((responseElement) => {
      responseElement.setAttribute("tabindex", "0");
    });
  }

  // The question text is at the opening fieldset tag OR at the top of the nextElement form for tables.
  if (moduleParams.renderObj?.activate) manageAccessibleQuestionInit(nextElement.querySelector('fieldset') || nextElement);

  const appState = getStateManager();
  appState.setActiveQuestionState(nextElement.id);
}

// Initialize the question text and focus management for screen readers.
// This drives the screen reader's question announcement and focus when a question is loaded.
export function manageAccessibleQuestionInit(fieldsetEle, isModalClose = false) {
  //reset the questionFocusSet flag on modal close so the question is read by the screen reader.
  if (isModalClose) questionFocusSet = false;

  if (fieldsetEle && !questionFocusSet) {
    // Announce the question text
    let { text: questionText, focusNode } = buildQuestionText(fieldsetEle);

    // Make sure focusable element is in the right location for screen reader focus management.
    let focusableEle = fieldsetEle.querySelector('span[tabindex="0"]');
    if (!focusableEle) {
      focusableEle = document.createElement('span');
      focusableEle.setAttribute('tabindex', '0');
      focusableEle.style.cssText = `
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      `;
      fieldsetEle.insertBefore(focusableEle, focusNode);
    }

    // For VoiceOver, update the focusable element with the question text.
    focusableEle.textContent = '';

    const isTable = !!fieldsetEle.querySelector('table')
    if (isTable) questionText += ' Please use your arrow keys to interact with the table below.'

    setTimeout(() => {
      focusableEle.textContent = questionText;
      focusableEle.focus();
    }, 100);

    questionFocusSet = true;
  }
}

// Build the question text for screen readers.
// Calculate the breakpoint between question and responses for accessible focus management.
// Focus on the invisible focusable element to manage screen reader focus.
// This sets the starting accessible control point just after the question text and before the responses list or table. 
function buildQuestionText(fieldsetEle) {
  let mainQuestionText = '';
  let focusNode = null;

  // The conditions for building textContent (survey questions) for the screen reader.
  const textNodeConditional = (node) => node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && !['INPUT', 'BR', 'LABEL', 'TABLE'].includes(node.tagName) && !node.classList.contains('response'));
  const childNodes = Array.from(fieldsetEle.childNodes);

  for (const node of childNodes) {
    if (textNodeConditional(node)) {
      mainQuestionText += node.textContent.trim() + ' ';
    } else if (node.tagName === 'BR') {
      continue; // Skip breaks (some questions have multiple paragraphs).
    } else {
      focusNode = node; // The focus node splits questions and responses. The invisible focusable element is placed here.
      break;
    }
  }

  // If a breakpoint isn't found (common in intros where there are no responses), set it to the last child node.
  // For that case, we don't need to search for additional questions.
  if (!focusNode) {
    focusNode = childNodes[childNodes.length - 1];
  } else {
    handleMultiQuestionSurveyAccessibility(childNodes, fieldsetEle, focusNode);
  }

  // Return the focus node for screen reader focus management.
  return { text: mainQuestionText.trim(), focusNode };
}

// Find additional questions (e.g. QoL multi-question surveys).
// Start after the focus node since the initial question is handled above for all cases.
// Swap those nodes (text, <b>, <u>, <i>, and embedded <br>) into divs and add a tabindex to make them focusable for screen reader accessibility.
function handleMultiQuestionSurveyAccessibility(childNodes, fieldsetEle, focusNode) {
  let currentQuestion = '';
  let nodesToRemove = [];

  let startIndex = childNodes.indexOf(focusNode) + 1;
  for (let i = startIndex; i < childNodes.length; i++) {
    const node = childNodes[i];

    // Stop at the first input/Table/Label node. Multi-question surveys don't have these nodes.
    // Note: This may require future adjustment depending on future survey structure.
    if (['INPUT', 'TABLE', 'LABEL'].includes(node.tagName)) {
      break;
    }

    // If the node is a text node and not empty, add it to the current question.
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== ''){
      currentQuestion += node.textContent.trim() + ' ';
      nodesToRemove.push(node);
    // If currentQuestion is popluated and the node is a <br>, that marks the end of a question. Note: exclude text nodes with '\n' only.
    // Wrap the current question in a div and add a tabindex. Remove the next <br> node if it exists to preserve spacing.
    } else if (['U', 'B', 'I'].includes(node.tagName)) {
      const tag = node.tagName.toLowerCase();
      currentQuestion += `<${tag}>${node.textContent.trim()}</${tag}> `;
      nodesToRemove.push(node);

    // If currentQuestion is popluated and the node is a <br>, retain the br for accurate spacing.
    } else if (node.tagName === 'BR') {
      if (currentQuestion && currentQuestion.trim() !== '') {
        currentQuestion += '<br>';
        nodesToRemove.push(node);
      }
    }
    // If currentQuestion is popluated and the node is a <div>, these parameters mark the end of the quesiton.
    else if (currentQuestion && currentQuestion.trim() !== '' && node.classList?.contains('response')) {
        const div = document.createElement('div');
        div.innerHTML = currentQuestion.trim();
        div.setAttribute('tabindex', '0');
        div.setAttribute('role', 'alert');

        // Insert the new div before the first node to remove
        fieldsetEle.insertBefore(div, nodesToRemove[0]);

        // Remove the tracked nodes in reverse order
        for (let j = nodesToRemove.length - 1; j >= 0; j--) {
          fieldsetEle.removeChild(nodesToRemove[j]);
        }

        // Reset the current question and nodes to remove to begin searching for the next question.
        nodesToRemove = [];
        currentQuestion = '';
    }
  }
}

// Check whether the browser supports "month" input type.
// Browsers that do not support 'month' use 'text' input type fallback.
// So input.type === 'month' -> true when supported and false otherwise.
function isMonthInputSupported() {
  const input = document.createElement('input');
  input.setAttribute('type', 'month');
  return input.type === 'month';
}

export async function previousClicked(norp) {
  // get the previousElement...
  let pv = questionQueue.previous();
  while (pv.value.value.substring(0, 9) == "_CONTINUE") {
    pv = questionQueue.previous();
  }

  const previousElementID = pv.value.value;

  const appState = getStateManager();
  await appState.syncToStore();
  
  let prevElement = document.getElementById(previousElementID);
  norp.form.classList.remove("active");

  restoreResponses(appState.getSurveyState(), previousElementID);
  displayQuestion(prevElement)

  return prevElement;
}

// this function just adds questions to the
// question queue.  It always returns null;
function checkForSkips(questionElement) {
  // get selected responses
  let selectedElements = getSelectedResponses(questionElement);

  let numSelected = selectedElements.filter((x) => x.type != "hidden").length;
  // if there are NO non-hidden responses ...
  if (numSelected == 0) {
    // there may be either a noResponse, a default response
    // or both or neither...

    // sort array so that noResponse comes first..
    // noResponse has a classlist length of 1/default =0
    let classSort = function (a, b) {
      return b.length - a.length;
    };
    selectedElements.sort(classSort);
  } else {
    // something was selected... remove the no response hidden tag..
    selectedElements = selectedElements.filter(
      (x) => !x.classList.contains("noresponse")
    );
  }

  // if there is a skipTo attribute, add them to the beginning of the queue...
  // add the selected responses to the question queue
  selectedElements = selectedElements.filter((x) => x.hasAttribute("skipTo"));

  // if there is an if attribute, check to see if condition is true and leave it in the selectedElements
  // otherwise, remove it from the selectedElements
  selectedElements = selectedElements.filter((x) => {
    if (!x.hasAttribute("if")) {
      return true;
    }
    return evaluateCondition(x.getAttribute("if"));
  });

  // make an array of the Elements, not the input elments...
  var ids = selectedElements.map((x) => x.getAttribute("skipTo"));

  // add all the selected elements with the skipTo attribute to the question queue
  if (ids.length > 0) {
    questionQueue.add(ids);
  }

  return null;
}

function checkValid(questionElement) {
  if (questionElement.classList.contains("invalid")) {
    return false;
  } else {
    return questionElement.checkValidity();
  }
}

//check if grids has all answers
export function gridHasAllAnswers(questionFieldset) {
  let gridRows = Array.from(questionFieldset.querySelectorAll("tr[data-gridrow='true']"));

  const checked = (element) => element.checked;
  return gridRows.reduce( (acc,current,index) => {
    if (current.style.display=='none') return acc // skip hidden rows

    let name = current.dataset.questionId
    let currentResponses = Array.from(current.parentElement.querySelectorAll(`input[type="radio"][name="${name}"], input[type="checkbox"][name="${name}"]`))
    return acc && currentResponses.some(checked)
  },true)
}

export function numberOfUnansweredGridQuestions(questionFieldset) {
  let gridRows = Array.from(questionFieldset.querySelectorAll("tr[data-gridrow='true']"));
  const checked = (element) => element.checked;
  return gridRows.reduce( (acc,current,index) => {
    if (current.style.display=='none') return acc // skip hidden rows

    let name = current.dataset.questionId
    let currentResponses = Array.from(current.querySelectorAll(`input[type="radio"][name="${name}"], input[type="checkbox"][name="${name}"]`));
    return currentResponses.some(checked)?acc:(acc+1)
  },0)
}


//check if radio/checkboxes with inputs attached has all of the required values
//does a double loop through of each radio/checbox, if checked then the following inputs must not have a empty value
export function radioCbHasAllAnswers(questionElement) {
  let hasAllAnswers = false;
  for (let i = 0; i < questionElement.length - 1; i++) {
    if ((questionElement[i].type === "checkbox" || questionElement[i].type === "radio") && questionElement[i].checked) {
      for (let j = i + 1; j < questionElement.length - 1; j++) {
        if (questionElement[j].type === "checkbox" || questionElement[j].type === "radio" || questionElement[j].type === "submit") {
          hasAllAnswers = true;
          break;
        } else if ((questionElement[j].type === "number" || questionElement[j].type === "text" || questionElement[j].type === "date" || questionElement[j].type === "email") && questionElement[j].value === "" && questionElement[i].style.display != "none") {
          return false;
        }
      }
    }
  }
  return hasAllAnswers;
}

// Look at radio, checkboxes, input fields, and hidden elements and return all checked or filled items.
// If nothing is checked, return empty array.
export function getSelectedResponses(questionElement) {
  const radiosAndCheckboxes = [...questionElement.querySelectorAll("input[type='radio'],input[type='checkbox']")].filter((x) => x.checked);
  const inputFields = [...questionElement.querySelectorAll("input[type='number'], input[type='text'], input[type='date'], input[type='month'], input[type='email'], input[type='time'], input[type='tel'], textarea, option")].filter((x) => x.value.length > 0);
  const hiddenInputs = [...questionElement.querySelectorAll("input[type='hidden']")].filter((x) => x.hasAttribute("checked"));

  return [...radiosAndCheckboxes, ...inputFields, ...hiddenInputs];
}

// RegExp to segment text conditions passed in as a string with '[', '(', ')', ',', and ']'. https://stackoverflow.com/questions/6323417/regex-to-extract-all-matches-from-string-using-regexp-exec
const evaluateConditionRegex = /[\(\),]/g;

/**
 * Try to evaluate using mathjs. Use fallback evaluation in the catch block.
 * math.evaluate(<string>) is a built-in mathjs func to evaluate string as mathematical expression.
 * @param {string} evalString - The string condition (markdown) to evaluate.
 * @returns {any}- The result of the evaluation.
 */

export function evaluateCondition(evalString) {
  evalString = decodeURIComponent(evalString);
  console.log('EVALUATE CONDITION:', evalString);


  try {
    return math.evaluate(evalString)
  } catch (err) {
    console.log('Using custom evaluation for:', evalString);
    
    let displayIfStack = [];
    let lastMatchIndex = 0;

    // split the displayif string into a stack of strings and operators
    for (const match of evalString.matchAll(evaluateConditionRegex)) {
      displayIfStack.push(evalString.slice(lastMatchIndex, match.index)); 
      displayIfStack.push(match[0]);
      lastMatchIndex = match.index + 1;
    }

    // remove all blanks
    displayIfStack = displayIfStack.filter((x) => x != "");

    // Process the stack
    while (displayIfStack.indexOf(")") > 0) {
      const stackEnd = displayIfStack.indexOf(")");

      if (isValidDisplayIfSyntax(displayIfStack, stackEnd)) {
        const { func, arg1, arg2 } = getFunctionArgsFromStack(displayIfStack, stackEnd);
        console.warn('FUNC:', func, 'ARG1:', arg1, 'ARG2:', arg2); // Temp for debugging
        const functionResult = knownFunctions[func](arg1, arg2);
        console.warn('FUNCTION RESULT:', functionResult); // Temp for debugging

        // Replace from callEnd-5 to callEnd with the results. Splice at callEnd-5, remove 6, add the calculated value.
        displayIfStack.splice(stackEnd - 5, 6, functionResult);

      } else {
        throw { Message: "Bad Displayif Function: " + evalString, Stack: displayIfStack };
      }
    }

    return displayIfStack[0];
  }
}

// Test the displayif syntax for a valid function call (converting displayif string to function call).
const isValidDisplayIfSyntax = (stack, stackEnd) => {
  return stack[stackEnd - 4] === "(" &&
    stack[stackEnd - 2] === "," &&
    stack[stackEnd - 5] in knownFunctions
}

// func, arg1, arg2 are in the stack at specific locations: callEnd-5, callEnd-3, callEnd-1
function getFunctionArgsFromStack(stack, callEnd) {
  const appState = getStateManager();
  const surveyState = appState.getSurveyState();

  const func = stack[callEnd - 5];
  
  let arg1 = stack[callEnd - 3];
  arg1 = evaluateArg(arg1, appState, surveyState);

  let arg2 = stack[callEnd - 1];
  arg2 = evaluateArg(arg2, appState, surveyState);

  return { func, arg1, arg2 };
}

// Evaluate the individual args embedded in conditions.
function evaluateArg(arg, appState, surveyState) {
  console.log("evaluateArg: ===>", arg, typeof arg);

  // return early if arg is not a string
  if (typeof arg !== 'string') return arg;

  if (arg in surveyState) {
    const value = surveyState[arg];

    // If the value is a string, return it.
    // Checkbox groups are saved as arrays. If the value exists in the array, it was checked.
    if (typeof value === 'string' || Array.isArray(value)) {
      console.log('RETURNING VALUE (string or array):', value); // Temp for debugging
      return value;
    }
    
    // If the value is an object, it's stored as { key: { key: value }} return the value of the inner key.
    // There may be two inner keys. The unmatched key is for 'other' text fields.
    else if (typeof value === 'object' && !Array.isArray(value)) {
      console.log('RETURNING VALUE (obj):', value[arg]); // Temp for debugging
      return value[arg];
    }
  }

  // const element = document.getElementById(arg);
  // console.log("element: ===>", element)

  // // If arg is an element ID, return the value of the element.
  // if (element) {
  //   // TODO: handle this case
  //   if (element.dataset.grid && (element.type === "radio" || element.type === "checkbox")) {
  //     //for displayif conditions with grid elements
  //     console.log('GRID ELEMENT:', element);
  //     console.log('GRID ELEMENT - checked?:', element.checked);
  //     //return surveyState[arg] //is the grid element checked? -> is the id in the array?
  //     return element.checked ? 1 : 0;
  //   }


  // // Else, look for the arg by name // TODO: handle this case
  // //const checkedElement = surveyState[arg]//.find((radioOrCheckbox) => radioOrCheckbox.checked);
  // const checkedElement = [...document.getElementsByName(arg)].find((radioOrCheckbox) => radioOrCheckbox.checked);
  // console.log("checkedElement: ===>", checkedElement);
  // if (checkedElement) {
  //   //console.log('CHECKED ELEMENT - Value:', checkedElement.value);
  //   return checkedElement.value;
  // }

  // If it's neither, look in the previous module
  if (arg in moduleParams.previousResults) {
    return moduleParams.previousResults[arg];
  }

  // If it's a number, return it as a string for direct evaluation.
  const parsedArg = parseInt(arg, 10) || parseFloat(arg);
  if (!isNaN(parsedArg)) {
    console.log('RETURNING PARSED ARG:', arg); // Temp for debugging
    return arg;
  }
  
  // Search for nested values in the state.
  const nestedArg = appState.findNestedValue(arg);
  if (nestedArg) {
    console.log('RETURNING NESTED ARG:', nestedArg); // Temp for debugging
    return nestedArg;
  }

  // If all else fails, return the original arg. Unhandled case.
  console.warn('TODO: (unhandled case) RETURNING ARG (default):', arg); // Temp for debugging
  return arg;
}

// TODO: get rid of Window dependency
window.questionQueue = questionQueue
