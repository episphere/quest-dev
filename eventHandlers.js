import { rbAndCbClick, handleXOR, parseSSN, parsePhoneNumber, textboxinput, radioAndCheckboxUpdate, moduleParams } from "./questionnaire.js";
import { clearValidationError } from "./validate.js";
import { nextButtonClicked, previousButtonClicked } from "./questionnaire.js";
import { getStateManager } from "./stateManager.js";
import { manageAccessibleQuestion } from "./accessibleQuestionTextBuilder.js";

// Debounced version of handleInputEvent
const debouncedHandleInputEvent = debounce(handleInputEvent, 250);

// Add event listeners to the div element (questContainer) -> delegate events to the parent div.
// Note: 'focusout' is used instead of 'blur' because 'blur' does not bubble to the parent div.
export function addEventListeners() {
  moduleParams.questDiv.addEventListener('click', handleClickEvent);
  moduleParams.questDiv.addEventListener('change', handleChangeEvent);
  moduleParams.questDiv.addEventListener('keydown', handleKeydownEvent);
  moduleParams.questDiv.addEventListener('keyup', handleKeyupEvent);
  moduleParams.questDiv.addEventListener('input', debouncedHandleInputEvent);
  moduleParams.questDiv.addEventListener('focusout', handleBlurFocusoutEvent);
  moduleParams.questDiv.addEventListener('submit', handleSubmitEvent);

  // Attach event listeners to modal and close buttons (for screen readers)
  // Modals are at the questDiv level, not embedded in the question.
  const modal = moduleParams.questDiv.querySelector('#softModal');
  const closeButton = moduleParams.questDiv.querySelector('#closeModal');

  modal?.addEventListener('click', closeModalAndFocusQuestion);
  closeButton?.addEventListener('click', closeModalAndFocusQuestion);

  addSubmitSurveyListener();
}

function handleClickEvent(event) {
  const target = event.target;
  
  if (target.matches('input[type="radio"], input[type="checkbox"]')) {
    rbAndCbClick(event);
    
    // Handle radio button and checkbox clicks for label inputs
    const label = target.closest('label');
    if (label) {
      const inputElement = label.querySelector('input:not([type="radio"]):not([type="checkbox"]), textarea');
      if (inputElement) {
        if (!target.checked) {
          inputElement.dataset.lastValue = inputElement.value;
          inputElement.value = '';
        } else if ('lastValue' in inputElement.dataset) {
          inputElement.value = inputElement.dataset.lastValue;
        }
        textboxinput(inputElement);
      }
    }

    // Handle text inputs in radio/checkbox lists (e.g. "Other" text inputs). They're inside a response container..
    // Auto-focus the text input if the outer response element (radio or checkbox) is clicked.
    // Note: Some are checkboxes and some are radios though they look the same.
    // Skip in the renderer because focus() causes issues (ensure moduleParams.activate === true).
    if (!moduleParams.isRenderer) {
      const responseContainer = target.closest('.response');
      const textInputElement = responseContainer?.querySelector('input[type="text"], textarea');
      if (textInputElement && !textInputElement.value && target.checked) {
        setTimeout(() => {
          textInputElement.focus({ preventScroll: true });
        }, 0);
      }
    }
  }
}

function handleChangeEvent(event) {
  const target = event.target;
  
  // Firefox does not alway GRAB focus when the arrows are clicked. If a changeEvent fires, grab focus.
  if (moduleParams.isFirefoxBrowser && target.matches('input[type="number"]') && target !== document.activeElement) {
    target.focus({ preventScroll: true });
  }

  if (target.matches('input[type="radio"], input[type="checkbox"]')) {
    rbAndCbClick(event);
  }

  // VoiceOver (MAC) handles table focus well, but JAWS (Windows) does not.
  // Ensure we're not in the renderer (skip this handling for the renderer).
  // We check if the environment is Windows and the target is a radio or checkbox to improve accessible UX for JAWS users.
  if (!moduleParams.isRenderer && target.matches('input[type="radio"], input[type="checkbox"]')) {
    
    const isTable = target.closest('table') !== null;

    if (moduleParams.isWindowsEnvironment) {
      if (isTable) {
        handleRadioCheckboxTableEvents(event);
      } else {
        handleRadioCheckboxListEvents(event);
      }
    } else {
      if (isTable) {
        updateAriaLiveSelectionAnnouncerTable(target.closest('.response'));
      } else {
        updateAriaLiveSelectionAnnouncer(target.closest('.response')); 
      }
    }
  }
}

function handleKeydownEvent(event) {
  const target = event.target;
  
  // Prevent form submission on enter key
  if (target.matches('input') && event.keyCode === 13) {
    event.preventDefault();
  }
  
  // for each element with an xor, handle the xor on keydown
  if (target.matches('[xor]')) {
    handleXOR(target);
  }

  if (target.matches('input[type="text"], input[type="email"], input[type="tel"], textarea, select')) {
    if (!moduleParams.isRenderer && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      handleUpDownArrowKeys(event);
    }
  }
}

function handleKeyupEvent(event) {
  const target = event.target;
  
  if (target.matches('.SSN')) {
    parseSSN(event);
  }
  
  if (target.matches('input[type="tel"]')) {
    parsePhoneNumber(event);
  }

  if (target.matches('label input:not([type="radio"]):not([type="checkbox"]), label textarea')) {
    handleInputEvent(event);
  }
}

function handleBlurFocusoutEvent(event) {
  const target = event.target;
  
  if (target.matches('input[type="text"], input[type="number"], input[type="email"], input[type="tel"], input[type="date"], input[type="month"], input[type="time"], textarea, select')) {
    textboxinput(target);
    target.setAttribute("style", "size: 20 !important");
  }
}

function handleInputEvent(event) {
  const target = event.target;
  
  if (target.matches('input[type="text"], textarea')) {
    const label = target.closest('label');
    if (label) {
      const radioCB = moduleParams.questDiv.querySelector(`#${label.htmlFor}`) || label.querySelector('input[type="radio"], input[type="checkbox"]');
      if (radioCB && (radioCB.type === 'radio' || radioCB.type === 'checkbox')) {
        // Check or uncheck the radio or checkbox based on the text input length.
        target.value.length > 0 ? radioCB.checked = true : radioCB.checked = false;
        radioAndCheckboxUpdate(radioCB);
        target.dataset.lastValue = target.value;
        textboxinput(target);
      }
    }
  }
}

function handleSubmitEvent(event) {
  const target = event.target;

  if (target.matches('.question') || target.closest('.question')) {
      stopSubmit(event);
  }
}

// Close the modal and focus on the question text.
// Re-build the question text and focus management for screen readers.
function closeModalAndFocusQuestion(event) {
  const modal = moduleParams.questDiv.querySelector('#softModal');
  const isWindowClick = event.target === modal;
  const isButtonClick = ['close', 'modalCloseButton', 'modalContinueButton'].includes(event.target.id);

  if (isWindowClick || isButtonClick) {
    modal.style.display = 'none';

    // Find the active question
    const activeQuestion = moduleParams.questDiv.querySelector('.question.active');

    if (activeQuestion) {
      const isModalClose = true;
      setTimeout(() => {
        manageAccessibleQuestion(activeQuestion.querySelector('fieldset') || activeQuestion, isModalClose);
      }, 500);
    }
  }
}

// Custom Accessible handling for up/down arrow keys.
// This ensures focus doesn't trap accessible navigation in lists that have 'Other' text inputs.
// Only active when moduleParams.activate is true (inactive in the renderer because focus() causes issues).
function handleUpDownArrowKeys(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusNextElement(event.target);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusPreviousResponse(event.target);
  }
}

// Get the next focusable element.
// Important for JAWS compatibility with text input fields in radio/checkbox groups.
function focusNextElement(currentElement) {
  const focusableElements = 'a, button, input:not([type="hidden"]), label, select, textarea, [tabindex]:not([tabindex="-1"])';
  const allFocusable = Array.from(moduleParams.questDiv.querySelectorAll(focusableElements));

  const currentIndex = allFocusable.indexOf(currentElement);
  if (currentIndex !== -1) {
    let newIndex = currentIndex;
    let nextElement;

    do {
      newIndex ++;
      nextElement = allFocusable[newIndex];
    } while (nextElement && (nextElement === currentElement || (nextElement.tagName === 'INPUT' && nextElement.type === 'text' && document.activeElement === nextElement)));

    if (nextElement) {
      setTimeout(() => {
        nextElement.focus({ preventScroll: true })
      }, 0);
    }
  }
}

// Get the previous focuasble 'response' div.
// Important for JAWS compatibility with text input fields in radio/checkbox groups.
function focusPreviousResponse(currentElement) {
  const currentResponse = currentElement.closest('.response');
  if (currentResponse) {
    let previousResponse = currentResponse.previousElementSibling;
    while (previousResponse && !previousResponse.classList.contains('response')) {
      previousResponse = previousResponse.previousElementSibling;
    }
    if (previousResponse) {
      const focusableElements = previousResponse.querySelectorAll('a, button, input:not([type="hidden"]), label, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusableElements.length > 0) {
        setTimeout(() => {
          focusableElements[0].focus({ preventScroll: true });
        }, 0);
      }
    }
  }
  return null;
}

// Function to handle radio button clicks and changes in lists.
function handleRadioCheckboxListEvents(event) {
  const parentResponseDiv = event.target.closest('.response');
  const eleToFocus = parentResponseDiv.querySelector('input') || parentResponseDiv;
  updateAriaLiveSelectionAnnouncer(parentResponseDiv);
  setTimeout(() => {
    eleToFocus.focus({ preventScroll: true });
  }, 100);
}

// Function to handle radio button clicks and changes in tables.
// For accessibility. Focus management is seamless in VoiceOver (MAC) but flawed in JAWS (Windows).
// This manages the screen reader's table focus with a hidden element inside a table cell.
// The element moves to the cell when a radio button is clicked.
function handleRadioCheckboxTableEvents(event) {
  const radioOrCheckbox = event.target;
  const responseCell = radioOrCheckbox.closest('.response');

  if (responseCell) {
    const currentRow = responseCell.closest('tr');

    switch (radioOrCheckbox.type) {
      // If it's a radio click, focus the hidden element on the next question (the first column of the next row).
      case 'radio': {

        const nextRow = currentRow.nextElementSibling;
        // If next row exists, focus the question (the first cell in the next row).
        // Otherwise, focus the next question button so the user can continue.
        nextRow
          ? focusNextTableRowQuestion(nextRow)
          : focusNextQuestionButton();
      
        break;
      }

      // If it's a checkbox click, focus the hidden element on the selection so the user can continue making selections.
      // If middle of row, place focus back on the checkbox.
      // If end of row, focus the next question button so the user can continue.
      // If end of last row, focus the next question button so the user can continue.
      case 'checkbox': {
        updateAriaLiveSelectionAnnouncerTable(responseCell);
        const nextCell = responseCell.nextElementSibling;
        const isLastCellInRow = !nextCell;
        const isLastRow = !currentRow.nextElementSibling;

        if (isLastRow && isLastCellInRow) {
          focusNextQuestionButton();
        } else {
          focusSelectedCheckbox(responseCell);
        }
        break;
      }
      
      default:
        console.error('RadioCheckboxTableEvent: Invalid event type', event.type);
    }
  }
}

// Update the aria-live region with the current selection announcement in a list (for screen readers).
function updateAriaLiveSelectionAnnouncer(responseDiv) {
    const liveRegion = moduleParams.questDiv.querySelector('#ariaLiveSelectionAnnouncer');
    const label = responseDiv.querySelector('label');
    const input = responseDiv.querySelector('input[type="checkbox"], input[type="radio"]');

    if (!liveRegion || !label || !input) {
      return;
    }

    const actionText = input.checked ? 'Selected.' : 'Unselected.';
    const isTable = responseDiv.closest('table') !== null;
    const announcementText = isTable
      ? `${actionText}`
      : `${label.textContent} ${actionText}`;
    
    liveRegion.textContent = '';

    setTimeout(() => {
      liveRegion.textContent = announcementText;
    }, 250);
}

// Update the aria-live region with the current selection announcement in a table (for screen readers).
// Note: cell-specific targeting is required for dependable selection announcements.
function updateAriaLiveSelectionAnnouncerTable(responseDiv) {
  const liveRegion = moduleParams.questDiv.querySelector('#ariaLiveSelectionAnnouncer');
  const cell = responseDiv.closest('td'); // Get the closest table cell (td)
  const label = cell?.querySelector('label'); // Find the label within the cell
  const input = cell?.querySelector('input[type="checkbox"], input[type="radio"]'); 

  if (!liveRegion || !cell || !label || !input) {
    return;
  }

  const actionText = input.checked ? 'Selected.' : 'Unselected.';
  const announcementText = `${label.textContent} ${actionText}`;

  liveRegion.textContent = '';
  setTimeout(() => {
    liveRegion.textContent = announcementText;
  }, 250);
}

function focusNextTableRowQuestion(nextRow) {
  setTimeout(() => {
    const focusHelper = getFocusHelper();
    if (!focusHelper) return;

    const nextQuestionCell = nextRow.querySelector('th');
    if (!nextQuestionCell) {
      console.error('RadioCheckboxTableEvent: Next question cell not found', nextRow);
      return;
    }

    nextQuestionCell.appendChild(focusHelper);
    focusHelper.focus({ preventScroll: true });
  }, 100);  
}

// Focus the next question button after a selection is made.
// This handles the last row's selection in a radio table and the final selectable cell in a checkbox table.
function focusNextQuestionButton() {
  setTimeout(() => {
    const focusHelper = getFocusHelper();
    if (!focusHelper) return;

    const activeQuestion = moduleParams.questDiv.querySelector('.question.active');
    if (!activeQuestion) {
      console.error('Active question not found', document.activeElement);
      return;
    }

    const nextQuestionButton = activeQuestion.querySelector('button.next');
    if (!nextQuestionButton) {
      console.error('Next question button not found', activeQuestion);
      return;
    }

    nextQuestionButton.appendChild(focusHelper);
    focusHelper.focus({ preventScroll: true });
  }, 100);
}

function focusSelectedCheckbox(responseCell) {
  setTimeout(() => {
    const focusHelper = getFocusHelper();
    if (!focusHelper) return;

    responseCell.appendChild(focusHelper);
    focusHelper.focus({ preventScroll: true });
  }, 100);
}

function getFocusHelper() {
  const focusHelper = moduleParams.questDiv.querySelector('#srFocusHelper');
  if (!focusHelper) {
    console.error('Focus helper not found');
    return null;
  }

  return focusHelper;
}

function clearSelectionAnnouncement() {
  const liveRegion = moduleParams.questDiv.querySelector('#ariaLiveSelectionAnnouncer');
  if (liveRegion) {
    liveRegion.textContent = '';
  }
}

// Handle the next, reset, and back buttons
async function stopSubmit(event) {
  event.preventDefault();

  // Clear the selection announcement
  clearSelectionAnnouncement();

  const clickType = event.submitter.getAttribute('data-click-type');
  const buttonClicked = event.target.querySelector(`.${clickType}`);

  switch (clickType) {
    case 'previous':
      resetChildren(event.target);
      await previousButtonClicked(buttonClicked);
      break;

    case 'reset':
      resetChildren(event.target);
      break;

    case 'submitSurvey':
      new bootstrap.Modal(moduleParams.questDiv.querySelector('#submitModal')).show();
      break;

    case 'next':
      await nextButtonClicked(buttonClicked);
      break;

    default:
      console.error(`ERROR: Unknown button clicked: ${clickType}`);
  }
}

/**
 * Clear the target form element and remove any responses from the activeQuestionState.
 * activeQuestionState gets set to undefined in the stateManager.
 * @param {HTMLElement} target - The form element to reset.
 * @returns {void}
 */
function resetChildren(target) {
  
  const appState = getStateManager();
  appState.removeResponse(target.id);

  const nodes = target.elements;
  if (nodes == null) return;

  for (let node of nodes) {
    if (node.type === "radio" || node.type === "checkbox") {
      node.checked = false;
    } else if (node.type === "text" || node.type === "time" || node.type === "date" || node.type === "month" || node.type === "number") {
      node.value = "";
      clearValidationError(node)
    }
  }
}

// Debounce the input event to prevent multiple rapid-fire events.
function debounce(func, wait) {
  let timeout;
  return function execute(...args) {
      const later = () => {
          clearTimeout(timeout);
          func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
  };
}

function addSubmitSurveyListener() {
  moduleParams.questDiv.querySelector('#submitModalButton').onclick = async () => {
    const lastBackButton = moduleParams.questDiv.querySelector('#lastBackButton');
    if (lastBackButton) {
      lastBackButton.remove();
    }
    const submitButton = moduleParams.questDiv.querySelector('#submitButton');
    if (submitButton) {
      submitButton.remove();
    }

    // Submit the survey and reload the page.
    const appState = getStateManager();
    await appState.submitSurvey();
    location.reload();
  };
}
