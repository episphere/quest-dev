// TODO: The buttons can be attached to the parent div or the question. They don't need to be repeated in the question DOM (Caveat: renderer in question list format).
// TODO: use moduleParams to conditionally apply the button text. moduleParams.renderObj?.activate -> if true, add button text at render time in displayQuestion (embedded use). If false, add to DOM for each question (renderer).
export const getButtonDiv = (button_text_obj, hasInputField, questID, endMatch, target) => {

    let nextButton = endMatch
        ? ""
        : `<button type='submit' class='next w-100' ${target} aria-label='Next question' data-click-type='next'>${button_text_obj.next}</button>`;
    
    let resetButton = (questID === 'END')
        ? `<button type='submit' class='reset' id='submitButton' aria-label='Submit your survey' data-click-type='submitSurvey'>${button_text_obj.submit}</button>`
        : hasInputField
            ? `<button type='submit' class='reset w-100' aria-label='Reset this answer' data-click-type='reset'>${button_text_obj.reset}</button>`
            : "";

    let prevButton = (endMatch && endMatch[1]) === "noback"
        ? ""
        : (questID === 'END')
            ? `<button type='submit' class='previous w-100' id='lastBackButton' aria-label='Back to the previous section' data-click-type='previous'>${button_text_obj.back}</button>`
            : `<button type='submit' class='previous w-100' aria-label='Back to the previous question' data-click-type='previous'>${button_text_obj.back}</button>`;

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