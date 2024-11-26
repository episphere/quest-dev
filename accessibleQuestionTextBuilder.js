import { moduleParams } from './questionnaire.js';

/**
 * Initialize the question text and focus management for screen readers.
 * This drives the screen reader's question announcement and focus when a question is loaded.
 * Set the focus after a brief timeout to ensure the screen reader has time to process the new content.
 * @param {HTMLElement} fieldsetEle - The fieldset element containing the question text.
 * @param {Boolean} questionFocusSet - The flag to manage screen reader focus.
 * @param {Boolean} isModalClose - The flag to reset the questionFocusSet flag on modal close.
 * @returns {Boolean} - The updated questionFocusSet flag.
 */

export function manageAccessibleQuestion(fieldsetEle, questionFocusSet) {
    if (fieldsetEle && !questionFocusSet) {
        // Build the question text and get the focusable element
        let focusableEle = buildQuestionText(fieldsetEle);

        // Focus the hidden, focusable element
        setTimeout(() => {
            focusableEle.focus();
        }, 500);

        questionFocusSet = true;
    }

    return questionFocusSet;
}

/**
 * Build the question text for screen readers.
 * Calculate the breakpoint between question and responses for accessible focus management.
 * Create a legend tag for the question text - legend tags are automatically read by screen readers.
 * Create a hidden, focusable element for screen reader focus management.
 * This sets the starting accessible control point just after the question text and before the responses list or table. 
 * @param {HTMLElement} fieldsetEle - The fieldset element containing the question text.
 * @returns {HTMLElement} - The hidden, focusable element for screen reader focus management.
 */

function buildQuestionText(fieldsetEle) {
    let focusNode = null;

    // The conditions for building textContent (survey questions) for the screen reader.
    const textNodeConditional = (node) =>
        node.nodeType === Node.TEXT_NODE ||
        (node.nodeType === Node.ELEMENT_NODE &&
            !['INPUT', 'BR', 'LABEL', 'LEGEND', 'TABLE'].includes(node.tagName) &&
            !node.classList.contains('response'));

    const childNodes = Array.from(fieldsetEle.childNodes);

    // Collect the question text and find the split point for responses.
    const questionElements = [];
    for (const node of childNodes) {
        if (textNodeConditional(node)) {

            // Stop collecting for legend if we hit the input labels
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().startsWith('#')) {
                focusNode = node;
                break;
            }
            questionElements.push(node.cloneNode(true));
            // Stop looping if the text contains the 'a summary' text (otherwise the summary prompts get compressed).
            if (node.textContent && node.textContent.includes('a summary')) {
                focusNode = node.nextSibling;
                break;
            }
        } else if (node.tagName === 'BR') {
            continue; // Skip <br> tags.
        } else {
            focusNode = node; // The focus node splits questions and responses. The invisible focusable element is placed here.
            break;
        }
    }

    // Handle cases where no split point is found.
    if (!focusNode) {
        focusNode = childNodes[childNodes.length - 1];
    } else {
        handleMultiQuestionSurveyAccessibility(childNodes, fieldsetEle, focusNode);
    }
    
    // Create the <legend> tag for screen readers and move the question text into it.
    const updatedFieldset = manageLegendTag(fieldsetEle, questionElements);

    // Create and return the hidden, focusable element for screen reader focus management.
    return createFocusableElement(updatedFieldset, focusNode);
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

/**
 * Insert the <legend> tag for the question text. This is the accessible question text for screen readers.
 * Check for an existing <legend> tag since the user can navigate back and forth between questions.
 * Tables require special handling.
 * @param {HTMLElement} fieldsetEle - The fieldset element containing the question text.
 * @param {Array<Node>} questionElements - array of nodes to be added to the legend.
 */

function manageLegendTag(fieldsetEle, questionElements) {
    const existingLegend = fieldsetEle.querySelector('legend');
    if (existingLegend) return fieldsetEle;

    let legendEle = document.createElement('legend');
    legendEle.classList.add('question-text');

    // Add all question elements to the new <legend>.
    questionElements.forEach((el) => legendEle.appendChild(el));

    // Remove the original question elements to prevent duplication.
    questionElements.forEach((el) => {
        const originalNode = Array.from(fieldsetEle.childNodes).find(
            (child) => child.isEqualNode(el)
        );
        if (originalNode) {
            originalNode.remove();
        }
    });

    const table = fieldsetEle.querySelector('table');
    if (table) {
        // Create the table navigation instructions for screen readers as a visually hidden element in the legend.
        const tableInstructions = document.createElement('span');
        tableInstructions.classList.add('visually-hidden');
        tableInstructions.textContent = 'Please use your arrow keys to interact with the table below.';
        legendEle.appendChild(tableInstructions);

        // Create a new <fieldset> element, then add the <legend> to it.
        const newFieldset = document.createElement('fieldset');
        newFieldset.appendChild(legendEle);

        // Move the table inside the new <fieldset>
        table.parentNode.insertBefore(newFieldset, table);
        newFieldset.appendChild(table);
        removeBRAfterLegend(newFieldset);

        return newFieldset;

    } else {
        // Insert the <legend> as the first child of the existing <fieldset> for non-table questions.
        fieldsetEle.insertBefore(legendEle, fieldsetEle.firstChild);
        removeBRAfterLegend(fieldsetEle);
        return fieldsetEle;
    }
}

const removeBRAfterLegend = (fieldsetEle) => {
    const legendEle = fieldsetEle.querySelector('legend');
    if (!legendEle) return;
    let nextSibling = legendEle.nextSibling;
    while (nextSibling?.tagName === 'BR' && nextSibling.nextSibling?.tagName === 'BR') {
        fieldsetEle.removeChild(nextSibling);
        nextSibling = legendEle.nextSibling;
    }
}

/**
 * Create a hidden, focusable element for screen reader focus management in each question.
 * @param {HTMLElement} fieldsetEle - The fieldset element containing the question text.
 * @param {Node} focusNode - The node to place the focusable element after.
 * @returns {HTMLElement} - The hidden, focusable element for screen reader focus management.
 */

function createFocusableElement(fieldsetEle, focusNode) {
    let focusableEle = fieldsetEle.querySelector('span.screen-reader-focus');
    if (!focusableEle) {
        focusableEle = document.createElement('span');
        focusableEle.classList.add('screen-reader-focus');
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

        if (focusNode && fieldsetEle.contains(focusNode)) {
            fieldsetEle.insertBefore(focusableEle, focusNode);
        } else {
            const legendEle = fieldsetEle.querySelector('legend');
            if (legendEle) {
                legendEle.after(focusableEle);
            } else {
                fieldsetEle.appendChild(focusableEle);
            }
        }
    }

    return focusableEle;
}

/**
 * Close the modal and focus on the question text.
 * Re-build the question text and focus management for screen readers.
 * @param {Event} event - The event object.
 */
export function closeModalAndFocusQuestion(event) {
    const modal = moduleParams.questDiv.querySelector('#softModal');
    const isWindowClick = event.target === modal;
    const isButtonClick = event.target.closest('button.btn-close') ||
        ['modalCloseButton', 'modalContinueButton'].includes(event.target.id);

    if (isWindowClick || isButtonClick) {
        modal.style.display = 'none';

        // Find the active question
        const activeQuestion = moduleParams.questDiv.querySelector('.question.active');
        if (activeQuestion) {
            const questionFocusSet = false;
            setTimeout(() => {
                manageAccessibleQuestion(activeQuestion.querySelector('fieldset') || activeQuestion, questionFocusSet);
            }, 100);
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
