import { textboxinput, radioAndCheckboxUpdate } from "./questionnaire.js";
import { getStateManager } from "./stateManager.js";

// TODO: consider refactor for maintainability and readability.

/**
 * Restore Responses to already answered questions.
 * This activates on survey load (for unfinished surveys) and when the 'Back' button is clicked.
 * @param {Object} results - The surveyState object.
 * @param {string} questionID - The question ID.
 * @returns 
 */

export function restoreResponses(results, questionID) {
  const appState = getStateManager();
  appState.clearActiveQuestionState();
  
  function handleString(questionElement, id, value) {
    // check if we have a radiobutton/checkbox...
    let element = questionElement.querySelector(`[name='${id}'][value='${value.replaceAll("'", "\\'")}']`)
    if (element) {
      element.checked = true
      radioAndCheckboxUpdate(element)
      return;
    }
    // check for some kind of input element...
    element = questionElement.querySelector(`[id='${id}']`);
    if (element) {
      element.value = value
      textboxinput(element, false);
      return;
    }

    console.warn('RESTORE RESPONSES (unhandled response)', questionElement, id, value)
  }
  
  let formElement = document.querySelector("#" + CSS.escape(questionID));
  // not sure have a non-question would be here
  // but ignore it...
  if (!formElement) {
    return;
  }
  // each question has an object of results...
  if (!results[questionID]) return;

  // CASE 1:  it is just a simple value...
  if (typeof results[questionID] == "string") {
    // in this case get the first input/textarea in the form and fill it in.
    let element = formElement.querySelector("input,textarea,select");
    // If the element is not on the page
    // it could have been dynamically create (think SOCcer...) just return..
    if (!element) return
    // null handle element, skip if null (load failing when participant is in the middle of unanswered SOCcer questions)
    if (element?.type === "radio") {
      let selector = `input[value='${results[questionID]}']`;
      let selectedRadioElement = formElement.querySelector(selector);
      if (selectedRadioElement) {
        selectedRadioElement.checked = true;
      } else {
        console.log("RESTORE RESPONSE: Problem with radio:", element);
      }
      radioAndCheckboxUpdate(selectedRadioElement);
    } else {
      if (element?.type === "submit") {
        console.log(`RESTORE RESPONSE: Question ID ${questionID} response value: ${results[questionID]}. Submit button: skipping update.`);
        return;
      }

      element.value = results[questionID];
      textboxinput(element, false);
    }

    // we should return from here...
    // then we should handle the ARRAY case.
    // which is likely a combobox...
    //   create a handleArray function...
    // then we should handle the Object case
    //   again create a handleObject function
    //   that can be called recursively to handle
    //   any potential depth of the results JSON.
    //   also, handleObject should call handleString,
    //   handleArray and handleObject.
    //   Unfortunately, we need handleArray/handleString to
    //   handle a potential null id for the case where
    //   the results is simply a string or an array.
    // CASE 2: we have an object...
  } else {
    function getFromRbCb(rbCbName, result) {
      let checkboxElements = Array.from(
        formElement.querySelectorAll(`input[name=${rbCbName}]`)
      );
      checkboxElements.forEach((checkbox) => {
        if (result.includes(checkbox.value)) {
          checkbox.checked = true;
          radioAndCheckboxUpdate(checkbox);
        }
      });
    }

    if (Array.isArray(results[questionID])) {
      getFromRbCb(questionID, results[questionID]);
    } else {
      // Handle the object case
      Object.keys(results[questionID]).forEach((resKey) => {
        if (!resKey) {
          // added because dynamic questions sometimes muck up the previous button.
          console.log(`RESTORE RESPONSE: Empty key in QuestionID ${questionID} response value: ${results[questionID]}; skipping.`);
          return;
        }
        let resObject = results[questionID][resKey];
        let handled = false;
        if (typeof resObject == 'string') {
          handleString(formElement, resKey, resObject)
          handled = true;
        }
        if (Array.isArray(resObject)) {
          getFromRbCb(resKey, resObject);
          handled = true;
        }
        if (!handled && typeof resObject == "object") {
          // ok wasn't an array .. i.e. it wasnt a radiobutton...
          // how about an XOR object...
          let element = Array.from(
            formElement.querySelectorAll(`[xor="${resKey}"]`)
          );
          element.forEach((xorElement) => {
            if (resObject[xorElement.id])
              xorElement.value = resObject[xorElement.id];
          });
          handled = true;
        }
        // check for mulitple radio buttons on 1 page...
        let multiq = formElement.querySelector(`input[name='${resKey}'][value='${CSS.escape(resObject)}']`)
        if (multiq) {
          multiq.checked = true
          handled = true;
        }
        if (!handled && typeof resObject == "string") {
          let element = document.getElementById(resKey);
          if (element.tagName == "DIV" || element.tagName == "FORM") {
            // radio in grid???
            let selector = `input[value='${results[questionID][resKey]}']`;
            let selectedRadioElement = element.querySelector(selector);
            if (selectedRadioElement) {
              selectedRadioElement.checked = true;
            } else {
              console.warn("RESTORE RESPONSE: Problem with DIV/FORM:", element);
            }
            radioAndCheckboxUpdate(selectedRadioElement);
          } else {
            element.value = resObject;
            textboxinput(element, false);
          }
        }
      });
    }
  }
}
