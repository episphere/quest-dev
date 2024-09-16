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
export const questionQueue = new Tree();

/**
 * Determine the storage format for the response data.
 * Grid questions are stored as objects. Ensure each key is stored with the response.
 * Single response (radio) input questions are stored as primitives.
 * Multi-selection (checkbox) input questions are stored as arrays.
 * @param {HTMLElement} form - the form element being evaluated.
 * @returns {number} - the number of response keys.
 */

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
  appState.setNumResponseInputs(form.id, responseInputs.size);
  appState.clearOtherResponseInputEntries(form.id);
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
  const numResponses = appState?.getNumResponseInputs(form.id) || getNumResponseInputs(form);
  
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
  if ( (element.getAttribute("type") === "month" && /^\d{4}-\d{1,2}$/.test(attr)) || 
       (element.getAttribute("type") === "date" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(attr)) ){
    
    // if leading zero for single digit month was stripped by the browser, add it back.
    if (element.getAttribute("type") === "month" && /^\d{4}-\d$/.test(attr)) {
      attr = attr.replace(/-(\d)$/, '-0$1')
    }
    
    element.setAttribute(newAttrName, attr)
    return element;
  }

  if (attr) {
    if (isNaN(attr)) {
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
      element.setAttribute(newAttrName, tmpVal);
    } else {
      element.setAttribute(newAttrName, attr);
    }
  }
  return element;
}

/**
 * Replace the found argument with the form ID for accurate validation.
 * Sometimes the input element ID doesn't match the form ID due to the markdown/DOM structure.
 * Search for the parent form ID (which will match a key in state), and replace the date input ID for accurate validation.
 * Relevant for evaluateCondition calls e.g. min=valueOrDefault("<Some_ID>","2020-03").
 * @param {string} attribute - the attribute to resolve
 * @returns {string} - the resolved attribute.
 */
// TODO: This logic will need updating when DOM structure changes.
function resolveAttributeToParentID(attribute, appState) {
  const decodedAttribute = decodeURIComponent(attribute);

  // If item found in state, no further evaluation needed.
  if (appState.findResponseValue(decodedAttribute)) {
    return decodedAttribute;
  }
  
  // If not found in state, search for the parent form ID.
  const foundElement = document.getElementById(decodedAttribute);
  if (!foundElement) return decodedAttribute;
  
  return foundElement.closest("form")?.id ?? decodedAttribute;
}

/**
 * Resolve the entered attributes for the runtime evaluateCondition functions.
 * @param {string} attribute - the attribute to resolve (e.g. valueLength("ID")).
 * @returns {string} - the resolved value.
 */

const valueLengthRegex = /valueLength\(["']([a-zA-Z0-9_]+?)["'](.*)\)/;
const doesNotExistRegex = /doesNotExist\(["']([a-zA-Z0-9_]+?)["'](.*)\)/;
const existsRegex = /exists\(["']([a-zA-Z0-9_]+?)["'](.*)\)/;
const equalsRegex = /equals\(["']([a-zA-Z0-9_]+?)["'](.*)\)/;
const isNotDefinedRegex = /isNotDefined\(["']([a-zA-Z0-9_]+?)["'](.*)\)/;

const resolveRuntimeConditions = (attribute) => {
  const attributeConditionString = decodeURIComponent(attribute);
  const appState = getStateManager();

  // Check if the attribute contains nested functions (multiple conditions to evaluate from the markdown).
  function hasNestedFunctions(str) {
    const firstIndex = str.indexOf('(');
    if (firstIndex === -1) return false; // No '(' found
    
    const secondIndex = str.indexOf('(', firstIndex + 1);
    return secondIndex !== -1;
  }

  // Only simple functions are evaluated here. If the attribute contains nested functions, return early.
  // TODO: consider whether evaluateCondtion() might be a helpful optimization here.
  if (hasNestedFunctions(attributeConditionString)) {
    return null;
  }

  const resolveCondition = (regex, additionalConstraint = null) => {
    const match = attributeConditionString.match(regex);
    if (match && match[1]) {
      const idToSearch = match[1];
      if (idToSearch) {
        const value = appState.findResponseValue(idToSearch);
        if (typeof value === 'string' && value.length > 0 && (!additionalConstraint || !value.match(additionalConstraint))) {
          return value;
        }
      }
    }
  }

  const value = resolveCondition(valueLengthRegex, /\b\d{9}\b/) ||
    resolveCondition(doesNotExistRegex) ||
    resolveCondition(existsRegex) ||
    resolveCondition(equalsRegex) ||
    resolveCondition(isNotDefinedRegex)

  if (value !== null) {
    return value;
  }

  if (!['valueLength', 'doesNotExist', 'exists', 'equals', 'isNotDefined'].some(substring => attributeConditionString.includes(substring))) {
    console.error(`Unhandled attribute type in ${attributeConditionString} (resolveRuntimeConditions)`);
  }

  console.warn(`TODO: confirm empty string response in (resolveRuntimeConditions): ${attributeConditionString}`);
  
  return '';
}

/**
 * Evaluate the condition in the 'forid' attribute for runtime functions.
 * ForID attributes are used to evaluate conditions at runtime and update the DOM accordingly.
 * For questions where one response exists, we need to evaluate the parent ID (mismatch to the response ID).
 * When multiple responses exist, we evaluate the response ID directly.
 * @param {Array<Node>} forIDElementArray - the array of 'forid' elements to evaluate.
 * @returns {void} - updates the DOM with the evaluated values.
 */
const handleForIDAttributes = (forIDElementArray) => {
  const appState = getStateManager();

  if (forIDElementArray.length === 1) {
    const forIDElement = forIDElementArray[0];    
    const forid = decodeURIComponent(forIDElement.getAttribute("forid"));
    const parentID = resolveAttributeToParentID(forid, appState);

    const defaultValue = forIDElement.getAttribute("optional");
    const updatedValue = math.valueOrDefault(parentID, defaultValue);
    
    forIDElement.textContent = updatedValue;
    forIDElement.setAttribute('forid', parentID);

    // Update the parent displayif attribute if it exists.
    const outerSpan = forIDElement.closest(".displayif");
    if (outerSpan) {
      const parentDisplayIf = outerSpan.getAttribute('displayif').replace(forid, parentID);
      outerSpan.setAttribute('displayif', parentDisplayIf)
    }

  } else {
    forIDElementArray.forEach(element => {
      const forid = decodeURIComponent(element.getAttribute("forid"));
      const foundValue = appState.findResponseValue(forid);
      toggleElementVisibility(element, foundValue);
    });
  }
}

const toggleElementVisibility = (element, textContent) => {
  if (textContent) {
    element.style.display = null;
    element.textContent = textContent;
  } else {
    element.style.display = "none";
  }
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
        appState.removeResponseItem(formID, inputID, appState.getNumResponseInputs(formID));
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
          appState.removeResponseItem(element.form.id, element.id, appState.getNumResponseInputs(element.form.id));
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
        const numKeys = appState.getNumResponseInputs(element.form.id);
        const vals = appState.getItem(inputElement.form.id) ?? {};
        if (Object.prototype.hasOwnProperty.call(vals, key1) && Array.isArray(vals[key1]) && vals[key1].includes(elementValue)) {
          appState.removeResponseItem(element.form.id, key1, numKeys);
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
    appState.removeResponseItem(inputElement.form.id, sibling.id, appState.getNumResponseInputs(inputElement.form.id));
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
  
//   const appState = getStateManager();
//   const siblings = getXORSiblings(inputElement);
//   siblings.forEach((sibling) => {
//     appState.removeResponseItem(inputElement.form.id, sibling.id, appState.getNumResponseInputs(inputElement.form.id));
//     resetSiblingDOMValues(sibling);
//   });

//   return inputElement.value;
// }

// function getXORSiblings(inputElement) {
//   return [...inputElement.parentElement.querySelectorAll("input")].filter(sibling => 
//     sibling.id !== inputElement.id &&
//     sibling.hasAttribute("xor") &&
//     sibling.getAttribute("xor") === inputElement.getAttribute("xor")
//   );
// }

// function resetSiblingDOMValues(sibling) {
//   if (["checkbox", "radio"].includes(sibling.type)) {
//     sibling.checked = sibling.dataset.reset ? false : sibling.checked;
//   } else {
//     sibling.value = "";
//     clearXORValidationMessage(sibling);
//   }
// }

// function clearXORValidationMessage(inputElement) {
//   const messageSpan = inputElement.nextElementSibling?.children[0];
//   if (messageSpan?.tagName === "SPAN" && messageSpan.innerText.length !== 0) {
//     messageSpan.innerText = "";
//     inputElement.classList.remove("invalid");
//     inputElement.form.classList.remove('invalid');
//     inputElement.nextElementSibling.remove();
//   }
// }

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
      // do nothing
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

/**
 * Get the next question from the questionQueue if it exists. Otherwise get the next sequential question from the markdown.
 * @returns {string} - the ID of the next question.
 */
function getNextQuestionId() {
  let nextQuestionNode = questionQueue.next();

  if (nextQuestionNode.done) {
    console.log('NEXT QUESTION NODE (done)', nextQuestionNode.done);
    const appState = getStateManager();
    const questionProcessor = appState.getQuestionProcessor();
    const nextSequentialQuestionEle = questionProcessor.findQuestion(undefined);
    questionQueue.add(nextSequentialQuestionEle.id);
    nextQuestionNode = questionQueue.next();
  }

  return nextQuestionNode.value.value;
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
// The root is defined as null, so if the question is not the same as the
// current value in the questionQueue. Add it.  Only the root should be effected.
// NOTE: if the root has no children, add the current question to the queue
// and call next().
async function nextPage(norp) {
  const questionElement = norp.form;
  questionElement.querySelectorAll("[data-hidden]").forEach((x) => {
    console.log('HIDDEN ELEMENT (setResponsesInState)', x);
    x.value = "true"
    setResponsesInState(questionElement, x.value, x.id)
  });

  const appState = getStateManager();
  await appState.syncToStore();
  const questionProcessor = appState.getQuestionProcessor();

  if (checkValid(questionElement) === false) {
    return null;
  }


  if (questionQueue.isEmpty()) {
    console.log('QUESTION QUEUE IS EMPTY');
    questionQueue.add(questionElement.id);
    questionQueue.next();
  }

  // check if we need to add questions to the question queue
  checkForSkips(questionElement);

  let nextQuestionId = getNextQuestionId();  
  console.log('NEXT QUESTION ID', nextQuestionId);
  let nextQuestionEle = questionProcessor.loadNextQuestion(nextQuestionId);
  console.log('NEXT QUESTION ELE', nextQuestionEle);
  nextQuestionEle = exitLoop(nextQuestionEle);
  console.log('NEXT QUESTION ELE (after exitLoop)', nextQuestionEle);

  // before we add the next question to the queue...
  // check for the displayif status...
  while (nextQuestionEle?.hasAttribute("displayif")) {
    if (nextQuestionEle.classList.contains("question")) {
      let shouldDisplayQuestion = evaluateCondition(nextQuestionEle.getAttribute("displayif"));
      if (shouldDisplayQuestion) break;

      if (nextQuestionEle.id.substring(0, 9) != "_CONTINUE") questionQueue.pop();

      let nextQuestionId = nextQuestionEle.dataset.nodisplay_skip;
      if (nextQuestionEle.dataset.nodisplay_skip) {
        console.log('NEXT QUESTION ID (nodisplay_skip (after))', nextQuestionId);
        questionQueue.add(nextQuestionEle.dataset.nodisplay_skip);
      }

      nextQuestionId = getNextQuestionId();
      nextQuestionEle = questionProcessor.loadNextQuestion(nextQuestionId);
      nextQuestionEle = exitLoop(nextQuestionEle);
    } else {
      console.error(`Error (nextPage): nextQuestionEle is not a question element. ${nextQuestionEle}`);
      console.trace();
    }
  }

  console.log('NEXT QUESTION ELE (after displayif check / while loop)', nextQuestionEle);

  swapVisibleQuestion(nextQuestionEle);
}

function exitLoop(nextQuestionEle) {
  if (!nextQuestionEle || !nextQuestionEle.hasAttribute("firstquestion")) {
    return nextQuestionEle;
  }
  
  const appState = getStateManager();
  const questionProcessor = appState.getQuestionProcessor();
  const loopData = questionProcessor.getLoopData(nextQuestionEle.id);
  const loopMaxResponse = loopData?.loopMaxResponse;

  if (!loopMaxResponse) {
    console.error(`LoopData is null or undefined for ${nextQuestionEle.id}`);
    return nextQuestionEle;
  }

  const firstQuestion = parseInt(nextQuestionEle.getAttribute("firstquestion"));
  const loopIndex = parseInt(nextQuestionEle.getAttribute("loopindx"));

  console.log('LOOP MAX RESPONSE', loopMaxResponse);
  console.log('FIRST QUESTION', firstQuestion);
  console.log('LOOP INDEX (TODO: test this)', loopIndex);

  if (isNaN(loopMaxResponse) || isNaN(firstQuestion) || isNaN(loopIndex)) {
    console.error(`LoopMax, firstQuestion, or loopIndex is NaN for ${nextQuestionEle.id}: loopMax=${loopMaxResponse}, firstQuestion=${firstQuestion}, loopIndex=${loopIndex}`);
    return nextQuestionEle;
  }

  if (math.evaluate(firstQuestion > loopMaxResponse)) {
    nextQuestionEle = questionProcessor.findEndOfLoop();

    questionQueue.pop();
    questionQueue.add(nextQuestionEle.id);
    questionQueue.next();

    nextQuestionEle = questionProcessor.loadNextQuestion(nextQuestionEle.id);
  }
  
  return nextQuestionEle;
}


/**
 * Update the active question in the DOM.
 * Identifies the existing question and swaps it with the new question.
 * If an existing question is not found (this happens on startup), the new question is appended to the parent div.
 * @param {HTMLElement} questDiv - The parent div housing the Quest UI.
 * @param {string} questionHTMLString - The HTML string of the question to be swapped in.
 */
export function swapVisibleQuestion(questionEle) {
  if (!questionEle) {
    console.error(`swapVisibleQuestion: questionEle is null or undefined.`);
    return;
  }

  const questDiv = moduleParams.questDiv;

  const existingQuestionEle = questDiv.querySelector('.question');
  if (existingQuestionEle) {
    questDiv.replaceChild(questionEle, existingQuestionEle);
  } else {
    // Handle the survey loading case (first quesiton added).
    const modalEle = questDiv.querySelector('.modal');
    modalEle
      ? questDiv.insertBefore(questionEle, modalEle)
      : questDiv.appendChild(questionEle);
  }

  // Ensure the question is appended to the active DOM before calling displayQuestion for accessibility.
  displayQuestion(questionEle);

  return questionEle;
}

function removeExtraBRElements(rootElement) {
  let consecutiveBrs = [];
  
  // Traverse the DOM tree to find all <br> elements
  rootElement.querySelectorAll('br').forEach((br) => {
    if (consecutiveBrs.length > 0 && consecutiveBrs[consecutiveBrs.length - 1].nextElementSibling === br) {
      consecutiveBrs.push(br);
    } else {
      if (consecutiveBrs.length > 3) {
        // Remove all but the first two <br> elements
        consecutiveBrs.slice(3).forEach((extraBr) => extraBr.remove());
      }
      // Reset the array to start tracking a new sequence
      consecutiveBrs = [br];
    }
  });

  // Final check in case the last sequence of <br>s is at the end of the document
  if (consecutiveBrs.length > 3) {
    consecutiveBrs.slice(3).forEach((extraBr) => extraBr.remove());
  }
}

// Manage the text builder for screen readers (only build when necessary)
let questionFocusSet;

export function displayQuestion(questionElement) {
  // Fail gently in the renderer tool.
  if (!questionElement && !moduleParams.renderObj.activate) return;
  
  const appState = getStateManager();
  
  questionFocusSet = false;

  // When the input ID isn't the quesiton ID (e.g. YYYY-MM input), find the parent question ID
  const forIDElementArray = questionElement.querySelectorAll("span[forid]");
  if (forIDElementArray.length > 0) handleForIDAttributes(forIDElementArray);

  [...questionElement.querySelectorAll("input[data-max-validation-dependency]")].forEach((x) =>
      (x.max = document.getElementById(x.dataset.maxValidationDependency).value)); // TODO: (rm document search)

  [...questionElement.querySelectorAll("input[data-min-validation-dependency]")].forEach((x) =>
      (x.min = document.getElementById(x.dataset.minValidationDependency).value)); // TODO: (rm document search)

  // check all responses for next question
  [...questionElement.querySelectorAll('[displayif]')].forEach((elm) => {
    let f = evaluateCondition(elm.getAttribute("displayif"));
    elm.style.display = f ? null : "none";
  });

  // check for displayif spans...
  [...questionElement.querySelectorAll("span[displayif],div[displayif]")].forEach(elm => {
    const textContent = elm.textContent;
    const isPlainText = textContent === elm.innerHTML;

    if (elm.getAttribute('data-fallback') === null) {
        elm.setAttribute('data-fallback', isPlainText ? textContent : '');
    }

    const displayIfAttribute = elm.getAttribute("displayif");
    let f = evaluateCondition(displayIfAttribute);
    if (f) {
      elm.style.display = null;

      let displayIfText = resolveRuntimeConditions(displayIfAttribute) ?? elm.getAttribute('data-fallback');
      if (displayIfText) {
        if (textContent.startsWith(',')) {
          displayIfText = ', ' + displayIfText;
        }
        elm.textContent = displayIfText;
      }
    } else {
      elm.style.display = "none";
    }
  });

  [...questionElement.querySelectorAll("span[data-encoded-expression]")].forEach(elm=>{
      let f = evaluateCondition(decodeURIComponent(elm.dataset.encodedExpression))
      elm.innerText=f;
  });

  // ISSUE: 403
  // update {$e:}/{$u} and and {$} elements in grids when the user displays the question ...
  [...questionElement.querySelectorAll("[data-gridreplace]")].forEach((e) => {
    if (e.dataset.gridreplacetype == "_val") {
      e.innerText = math._value(decodeURIComponent(e.dataset.gridreplace))
    } else {
      e.innerText = math.evaluate(decodeURIComponent(e.dataset.gridreplace))
    }
  });
  
  // Check if grid elements need to be shown. Elm is a <tr>. If f !== true, remove the row (elm) from the DOM.
  [...questionElement.querySelectorAll("[data-gridrow][data-displayif]")].forEach((elm) => {
    const f = evaluateCondition(decodeURIComponent(elm.dataset.displayif));
    if (f !== true) {
      elm.dataset.hidden = "true";
      elm.style.display = "none";
    } else {
      delete elm.dataset.hidden;
      elm.style.display = "";
    }
  });

  //Replacing all default HTML form validations with datasets
  [...questionElement.querySelectorAll("input[required]")].forEach((element) => {
    if (element.hasAttribute("required")) {
      element.removeAttribute("required");
      element.dataset.required = "true";
    }
  });

  [...questionElement.querySelectorAll("input[min]")].forEach((element) => {
    exchangeValue(element, "min", "data-min");
  });
  [...questionElement.querySelectorAll("input[max]")].forEach((element) => {
    exchangeValue(element, "max", "data-max")
  });
  // supporting legacy code... dont use minval
  [...questionElement.querySelectorAll("input[minval]")].forEach((element) => {
    exchangeValue(element, "minval", "data-min");
  });
  [...questionElement.querySelectorAll("input[maxval]")].forEach((element) => {
    exchangeValue(element, "maxval", "data-max");
  });

  [...questionElement.querySelectorAll("input[data-min]")].forEach((element) =>
    exchangeValue(element, "data-min", "data-min")
  );
  [...questionElement.querySelectorAll("input[data-max]")].forEach((element) => {
    exchangeValue(element, "data-max", "data-max");
  });

  // rewrite the data-(min|max)-date-uneval with a calulated value
  [...questionElement.querySelectorAll("input[data-min-date-uneval]")].forEach((element) => {
    exchangeValue(element, "data-min-date-uneval", "data-min-date");
    exchangeValue(element, "data-min-date-uneval", "min");
  });

  [...questionElement.querySelectorAll("input[data-max-date-uneval]")].forEach((element) => {
    exchangeValue(element, "data-max-date-uneval", "data-max-date");
    exchangeValue(element, "data-max-date-uneval", "max");
  });

  questionElement.querySelectorAll("[data-displaylist-args]").forEach(element => {
    element.innerHTML = math.existingValues(element.dataset.displaylistArgs);
  });

  // handle unsupported 'month' input type (Safari for MacOS and Firefox)
  const monthInputs = questionElement.querySelectorAll("input[type='month']");
  if (monthInputs.length > 0 && !isMonthInputSupported()) {
    monthInputs.forEach(input => {
      input.setAttribute('placeholder', 'YYYY-MM');
    });
  }

  removeExtraBRElements(questionElement);

  //Sets the brs after non-displays to not show as well
  [...questionElement.querySelectorAll(`[style*="display: none"]+br`)].forEach((e) => {
    e.style = "display: none"
  });
  
  // Add aria-hidden to all remaining br elements. This keeps the screen reader from reading them as 'Empty Group'.
  [...questionElement.querySelectorAll("br")].forEach((br) => {
    br.setAttribute("aria-hidden", "true");
  });

  // JAWS (Windows) requires tabindex to be set on the response divs for the radio buttons to be accessible.
  // The tabindex leads to a negative user experience in VoiceOver (macOS).
  if (moduleParams.isWindowsEnvironment) {
    [...questionElement.querySelectorAll("div.response")].forEach((responseElement) => {
      responseElement.setAttribute("tabindex", "0");
    });
  }

  appState.setActiveQuestionState(questionElement.id);

  // The question text is at the opening fieldset tag OR at the top of the nextElement form for tables.
  if (moduleParams.renderObj?.activate) {
    handleUserScrollLocation();
    setTimeout(() => {
      manageAccessibleQuestion(questionElement.querySelector('fieldset') || questionElement);
    }, 500);
  }
}

// Scroll higher on tablets and computers to show the site header.
// Focus specifically on the quest div (questions and resopnses) for smaller screens to minimize scrolling.
function handleUserScrollLocation() {
  let rootElement;
  if (isMobileDevice()) {
    rootElement = document.getElementById('root') || moduleParams.questDiv.parentElement || moduleParams.questDiv;
  } else {
    rootElement = document.documentElement;
  }

  rootElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function isMobileDevice() {
  return window.matchMedia('(max-width: 767px)').matches;
}

// Initialize the question text and focus management for screen readers.
// This drives the screen reader's question announcement and focus when a question is loaded.
export function manageAccessibleQuestion(fieldsetEle, isModalClose = false) {
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

export async function previousClicked() {
  // Get the previousElement from questionQueue
  let pv = questionQueue.previous();
  while (pv.value.value.substring(0, 9) === "_CONTINUE") {
    pv = questionQueue.previous();
  }

  const previousElementID = pv.value.value;

  const appState = getStateManager();
  await appState.syncToStore();

  const questionProcessor = appState.getQuestionProcessor();
  const previousQuestionEle = questionProcessor.loadPreviousQuestion(previousElementID);
  
  swapVisibleQuestion(previousQuestionEle);
  restoreResponses(appState.getSurveyState(), previousElementID);
}

// this function just adds questions to the
// question queue.  It always returns null;
function checkForSkips(questionElement) {
  // get selected responses
  let selectedElements = getSelectedResponses(questionElement);

  let numSelected = selectedElements.filter((x) => x.type != "hidden").length;
  // if there are NO non-hidden responses ...
  if (numSelected == 0) {
    // there may be either a noResponse, a default response, both, or neither...
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
  return gridRows.reduce( (acc,current) => {
    if (current.style.display=='none') return acc // skip hidden rows

    let name = current.dataset.questionId
    let currentResponses = Array.from(current.parentElement.querySelectorAll(`input[type="radio"][name="${name}"], input[type="checkbox"][name="${name}"]`))
    return acc && currentResponses.some(checked)
  },true)
}

export function numberOfUnansweredGridQuestions(questionFieldset) {
  let gridRows = Array.from(questionFieldset.querySelectorAll("tr[data-gridrow='true']"));
  const checked = (element) => element.checked;
  return gridRows.reduce( (acc,current) => {
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
// TODO: test updated regexp
//const evaluateConditionRegex = /[\(\),]/g;
const evaluateConditionRegex = /[(),]/g;

/**
 * Try to evaluate using mathjs. Use fallback evaluation in the catch block.
 * math.evaluate(<string>) is a built-in mathjs func to evaluate string as mathematical expression.
 * @param {string} evalString - The string condition (markdown) to evaluate.
 * @returns {any}- The result of the evaluation.
 */

// TODO: loops: break out of a loop early to avoid unnecessary calculations (currently, all conditions are evaluated for every possible loop iteration).
export function evaluateCondition(evalString) {
  evalString = decodeURIComponent(evalString);

  try {
    return math.evaluate(evalString)
  } catch (err) { //eslint-disable-line no-unused-vars
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

    const appState = getStateManager();

    // Process the stack
    while (displayIfStack.indexOf(")") > 0) {
      const stackEnd = displayIfStack.indexOf(")");

      if (isValidFunctionSyntax(displayIfStack, stackEnd)) {
        const { func, arg1, arg2 } = getFunctionArgsFromStack(displayIfStack, stackEnd, appState);
        const functionResult = knownFunctions[func](arg1, arg2, appState);
        console.warn('FUNC:', func, 'ARG1:', arg1, 'ARG2:', arg2, 'RESULT', functionResult); // Temp for debugging

        // Replace from stackEnd-5 to stackEnd with the results. Splice and replace the function call with the result.
        displayIfStack.splice(stackEnd - 5, 6, functionResult);

        // TODO: look at ways to short-circuit the evaluation of 'or' functions when one evaluates to true and loops beyond the loop index.

      } else {
        throw { Message: "Bad Displayif Function: " + evalString, Stack: displayIfStack };
      }
    }

    return displayIfStack[0];
  }
}

// Test the string-based function syntax for a valid function call (converting markdown function strings to function calls).
const isValidFunctionSyntax = (stack, stackEnd) => {
  return stack[stackEnd - 4] === "(" &&
    stack[stackEnd - 2] === "," &&
    stack[stackEnd - 5] in knownFunctions
}

// func, arg1, arg2 are in the stack at specific locations: callEnd-5, callEnd-3, callEnd-1
function getFunctionArgsFromStack(stack, callEnd, appState) {
  const func = stack[callEnd - 5];
  
  let arg1 = stack[callEnd - 3];
  arg1 = evaluateArg(arg1, appState);

  let arg2 = stack[callEnd - 1];
  arg2 = evaluateArg(arg2, appState);

  return { func, arg1, arg2 };
}

/**
 * Evaluate the individual args embedded in conditions.
 * Return early for: undefined, hardcoded numbers and booleans (they get evaluated in mathjs), and known loop markers.
 * @param {string} arg - The argument to evaluate.
 * @param {*} appState - The application state.
 * @returns 
 */

function evaluateArg(arg, appState) {

  if (arg === null || arg === 'undefined') return arg;
  else if (typeof arg === 'number' || parseInt(arg, 10) || parseFloat(arg)) return arg;
  else if (['true', true, 'false', false].includes(arg)) return arg;
  else if (arg === '#loop') return arg;

  // Search for values in the surveyState. This search covers responses and 'previousResults' (passed in at startup).
  const foundValue = appState.findResponseValue(arg);
  if (foundValue) {
    return foundValue;
  } else {
    console.log('RETURNING (default) empty string for:', arg); // Temp for debugging
    return '';
  }
}

// TODO: get rid of Window dependency
//window.questionQueue = questionQueue
