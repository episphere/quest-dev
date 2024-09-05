// import { moduleParams, questions } from "./quest.js";
import { moduleParams, questions } from "./questionnaire.js";
import regex from "./regex.js";

/**
 * Splits text markdown into individual questions and validates them before adding to global questionnaire
 *
 * @param {string} text markdown containing structure of questionnaire to render
 */
export function parseMarkdown(text) {

    console.log("Parsing markdown...");
    extractModuleName(text);

    // text = prepareMarkdown(text);

    let markdownSplit = splitQuestions(text);
    
    markdownSplit.forEach(question => {
        
        let results;

        //if grid
        if (question.match(regex.gridGeneric)) {
            results = validateGrid(question);
            if(results) {
                questions.add(results);
            }
            else {
                // throw error
            }
        }
        //if loop
        else if (question.match(regex.loopGeneric)) {
            results = validateLoop(question);
            if(results) {
                questions.add(results);
            }
            else {
                // throw error
            }
        }
        //else
        results = validateQuestion(question);
        if(results) {
            questions.add(results);
        }
        else {
            // throw error
        }
    });
}

/**
 * Attempts to find the name of the questionnaire and set correlating module parameter
 *
 * @param {string} text markdown containing structure of questionnaire to render
 */
function extractModuleName(text) {

    let match = text.match(regex.moduleName);
    moduleParams.questName = match ? match[1] : "Module";

    console.log("Setting module name: " + moduleParams.questName);
}

/**
 * Breaks up text markdown based on regular expressions for normal, loop, and grid questions
 *
 * @param {string} text markdown containing structure of questionnaire to render
 * @returns {array} questions parsed from text markdown
 */
function splitQuestions(text) {
    
    let postLoop = [];
    let postGrid = [];
    let postQuestion = [];

    postLoop = text.split(regex.loopGeneric);

    postLoop.forEach(index => {
        let temp = index.split(regex.gridGeneric);

        temp.forEach(tempIndex => {
            postGrid.push(tempIndex);
        });
    });

    postGrid.forEach(index => {
        if(index.startsWith("<loop") || index.startsWith("|grid")) {
            postQuestion.push(index);
        }
        else {
            let temp = index.split(regex.questionGeneric);

            temp.forEach(tempIndex => {
                if(tempIndex) postQuestion.push(tempIndex);
            });
        }
    });

    return postQuestion;
}

/**
 * Performs a handleful of replace() transactions to cleanup markdown text passed in
 *
 * @param {string} text markdown containing structure of questionnaire to render
 * @returns {string} cleaned text markdown
 */
function prepareMarkdown(text) {
    text = text.replace(/[\r\n]/gm, '');

    return text;
}

/**
 * Verifies if markdown for normal quesion matches what is required, if so sets question parameters
 *
 * @param {string} text markdown containing structure of normal question to be rendered
 * @returns {object} question parameters if markdown is valid, else FALSE
 */
function validateQuestion(text) {

    let match = text.match(regex.questionSpecific);

    if(match) {
        let params = {};

        params.id = match[1];
        
        if(match[2]) {
            params.edit = match[2] == "!" ? "hard" : "soft";
        }

        params.args = match[3];
        params.text = match[4];
        params.type = "question";

        return params;
    }

    return false;
}

/**
 * Verifies if markdown for loop quesion matches what is required, if so sets question parameters
 *
 * @param {string} text markdown containing structure of loop question to be rendered
 * @returns {object} question parameters if markdown is valid, else FALSE
 */
function validateLoop(text) {
    
}

/**
 * Verifies if markdown for grid quesion matches what is required, if so sets question parameters
 *
 * @param {string} text markdown containing structure of grid question to be rendered
 * @returns {object} question parameters if markdown is valid, else FALSE
 */
function validateGrid(text) {

    let match = text.match(regex.gridSpecific);

    if(match) {
        let params = {};

        params.id = match[1];
        
        if(match[2]) {
            params.edit = match[2] == "!" ? "hard" : "soft";
        }

        params.args = match[3];
        params.text = match[4];
        params.type = "question";

        return params;
    }

    return false;
}