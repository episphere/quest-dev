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