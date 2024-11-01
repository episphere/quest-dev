import { moduleParams } from './questionnaire.js';

// Initialize the question text and focus management for screen readers.
// This drives the screen reader's question announcement and focus when a question is loaded.
export function manageAccessibleQuestion(fieldsetEle, questionFocusSet, isModalClose = false) {
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

    return questionFocusSet;
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
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '') {
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

// Close the modal and focus on the question text.
// Re-build the question text and focus management for screen readers.
export function closeModalAndFocusQuestion(event) {
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
export function handleUpDownArrowKeys(event) {
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
            newIndex++;
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
export function handleRadioCheckboxListEvents(event) {
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
export function handleRadioCheckboxTableEvents(event) {
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
                moduleParams.errorLogger('RadioCheckboxTableEvent: Invalid event type', event.type);
        }
    }
}

// Update the aria-live region with the current selection announcement in a list (for screen readers).
export function updateAriaLiveSelectionAnnouncer(responseDiv) {
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
export function updateAriaLiveSelectionAnnouncerTable(responseDiv) {
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
            moduleParams.errorLogger('RadioCheckboxTableEvent: Next question cell not found', nextRow);
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
            moduleParams.errorLogger('Active question not found', document.activeElement);
            return;
        }

        const nextQuestionButton = activeQuestion.querySelector('button.next');
        if (!nextQuestionButton) {
            moduleParams.errorLogger('Next question button not found', activeQuestion);
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
        moduleParams.errorLogger('Focus helper not found');
        return null;
    }

    return focusHelper;
}

export function clearSelectionAnnouncement() {
    const liveRegion = moduleParams.questDiv.querySelector('#ariaLiveSelectionAnnouncer');
    if (liveRegion) {
        liveRegion.textContent = '';
    }
}
