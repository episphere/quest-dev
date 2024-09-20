import { questionQueue, moduleParams, rbAndCbClick, swapVisibleQuestion } from "./questionnaire.js";
import { restoreResponses } from "./restoreResponses.js";
import { addEventListeners } from "./eventHandlers.js";
import { ariaLiveAnnouncementRegions, responseRequestedModal, responseRequiredModal, responseErrorModal, submitModal  } from "./common.js";
import { initSurvey } from "./initSurvey.js";
import { getStateManager } from "./stateManager.js";

import en from "./i18n/en.js";
import es from "./i18n/es.js";

export let transform = function () { /* init */ };
transform.rbAndCbClick = rbAndCbClick;

// TODO: wrap with error handling.
transform.render = async (obj, divID, previousResults = {}) => {
  console.log('CONFIRMING QUESTION SEPARATOR BRANCH');

  // Set the global moduleParams object with data needed for different parts of the app.
  setModuleParams(obj, divID, previousResults);
  
  // if the object has a 'text' field, the contents have been prefetched and passed in. Else, fetch the survey contents.
  const markdown = moduleParams.renderObj?.text || await fetch(moduleParams.renderObj?.url).then(response => response.text());

  // Initialize the survey and start processing the questions in the background.
  const retrievedData = await initSurvey(markdown);

  // Get the state manager and load the initial state. This prepares the state manager for use throughout the survey.
  const appState = getStateManager();
  appState.loadInitialSurveyState(retrievedData);
  const initialUserData = appState.getSurveyState();
  const questionProcessor = appState.getQuestionProcessor();

  // Load the question queue from the tree JSON.
  loadQuestionQueue(initialUserData?.treeJSON);

  // Initialize the active question, activate it, and display it.
  const activeQuestionID = getActiveQuestionID(questionProcessor.questions);

  // Set the active question in the DOM on survey startup and restore existing responses.
  const activeQuestionEle = setInitialQuestionOnStartup(questionProcessor, activeQuestionID, initialUserData);

  // If the active question is not found, and it's an embedded use case, log an error and return false.
  // Note: Fail silently for the renderer tool since users are actively editing and testing markdown.
  if (!activeQuestionEle && moduleParams.renderObj?.activate) {
    console.error('Active question not found for:', activeQuestionID);
    return false;
  }

  // Clear changed Items are cleared after the initial state is loaded.
  // This ensures only the user's changes are tracked on the starting question.
  appState.clearActiveQuestionState();
  
  // TODO: test loading/unloading/back button for soccer
  // If the soccer function is defined, call it. This is used for external listeners in the PWA.
  if (moduleParams.soccer instanceof Function) moduleParams.soccer();

  // Add the event listeners to the parent div.
  addEventListeners();

  // Offload the full survey processing to a worker thread while handling the active question in the main thread.
  //TODO: set up the worker and test.
  //processQuestionsInBackground(questionProcessor);

  return true;
};

/**
 * Load the question queue from the tree JSON. If treeJSON is empty, cleare the queue.
 * This is used to :
 * - Load the initial state of the survey.
 * - Load the state of the survey from the user's existing responses.
 * - Track the user's progress through the survey.
 * Note: It is built into all existing surveys (do not change or remove).
 * @param {Object} treeJSON - The treeJSON object containing the question queue.
 */
function loadQuestionQueue(treeJSON) {
  if (treeJSON) {
    try {
      questionQueue.loadFromJSON(treeJSON);
    } catch (error) {
      console.error('Error loading tree from JSON:', error);
      questionQueue.clear();
    }
  } else {
    questionQueue.clear();
  }
}

/**
 * Get the active question ID from questionQueue. If the queue is empty, add the first question to the queue and make it active.
 * @param {Array} questionsArray - The array of questions from the questionProcessor. 
 * @returns {string} - The ID of the active question.
 */

function getActiveQuestionID(questionsArray) {
  if (questionsArray.length === 0) {
    // TODO: handle eager execution inefficiency in renderer.
    if (!moduleParams.renderObj?.activate) console.error('No questions found in the survey.');
    return;
  }

  let currentQuestionID = questionQueue.currentNode.value;
  if (!currentQuestionID) {
    currentQuestionID = questionsArray[0].questionID;
    questionQueue.add(currentQuestionID);
    questionQueue.next();
  } else if (currentQuestionID.startsWith('_CONTINUE')) {
    questionQueue.pop();
    currentQuestionID = questionQueue.currentNode.value;
  }
  
  return currentQuestionID;
}

/**
 * Set the active question in the DOM on survey startup. This executes once, just after initialization.
 * If the active question is not found, there's a setup error from the caller. Log an error and return.
 * @param {Object} questionProcessor - The question processor object for processing markdown to HTML and managing questions.
 * @param {string} activeQuestionID - The ID of the active question to set.
 * @param {Object} initialUserData - The initial user data object containing the user's existing responses.
 * @returns {void} - this manages the DOM on survey startup.
 */

function setInitialQuestionOnStartup(questionProcessor, activeQuestionID, initialUserData) {
  if (!activeQuestionID) return;

  const isInitialLoad = true; // Defined for clarity.
  const questionEle = questionProcessor.findQuestion(activeQuestionID, isInitialLoad);

  if (!questionEle) {
    console.error('Active question not found:', activeQuestionID, questionEle);
    return;
  }

  swapVisibleQuestion(questionEle);
  initialUserData[activeQuestionID] && restoreResponses(initialUserData, activeQuestionID);
  
  return questionEle;
}

function setModuleParams(obj, divID, previousResults) {
  moduleParams.renderObj = obj; // future todo: we have some duplication between moduleParams.obj, moduleParams.renderObj, and obj throughout the code.
  moduleParams.previousResults = previousResults;
  moduleParams.soccer = obj.soccer;
  moduleParams.delayedParameterArray = obj.delayedParameterArray;
  moduleParams.i18n = obj.lang === 'es' ? es : en;
  moduleParams.isWindowsEnvironment = isWindowsEnvironment();
  moduleParams.isFirefoxBrowser = isFirefoxBrowser();
  moduleParams.isLocalDevelopment = isLocalDevelopment();
  moduleParams.questDiv = document.getElementById(divID);
  moduleParams.questDiv.innerHTML = ariaLiveAnnouncementRegions() + responseRequestedModal() + responseRequiredModal() + responseErrorModal() + submitModal();

  // TODO: THE !isDev (falsy) PATH SHOULD BE SET TO THE NEW CDN PATH FOR STAGE and PROD!!! (e.g. `https://cdn.jsdelivr.net/gh/episphere/quest-dev@v${moduleParams.renderObj?.questVersion}/`)
  // Set the base path for the module. This is used to fetch the stylesheets in init -> .
  moduleParams.basePath = !moduleParams.isLocalDevelopment && moduleParams.renderObj?.questVersion
    ? 'https://episphere.github.io/quest-dev/'
    : './js/quest-dev/' //`https://episphere.github.io/quest-dev/`;
}

function isLocalDevelopment() {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.includes('github');
}

// Helper for accessibility features. Certain JAWS (Windows) and VoiceOver (Mac) features are handled differently by each platform.
// This detection helps optimize the user experience on each platform.
function isWindowsEnvironment() {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.indexOf("win") > -1;
}

// Helper for focus issues in Firefox. Firefox has a bug where the focus is not set correctly on numeric up/down arrows.
// InstallTrigger is a global object in Firefox that is not present in other browsers.
function isFirefoxBrowser() {
  return typeof InstallTrigger !== 'undefined';
}

// TODO: implement this functionality in the worker
function processQuestionsInBackground(questionProcessor) {
  questionProcessor.processAllQuestions(); // Process all questions inline

}
// TODO: implement this
//   const worker = new Worker(`${moduleParams.basePath}transformMarkdownWorker.js`, { type: 'module' });

//   worker.postMessage({
//     command: 'processQuestions',
//     data: {
//       questions: questionProcessor.questions,
//       questName: questionProcessor.questName,
//       precalculatedValues: questionProcessor.precalculated_values,
//       i18n: questionProcessor.i18n
//     }
//   });

//   worker.onmessage = (event) => {
//     if (event.data.command === 'processComplete') {
//       questionProcessor.isProcessingComplete = true;
//       const processedQuestionsHTML = questionProcessor.processAllQuestions(); // Process all questions inline
//       console.log('Background processing complete:', processedQuestionsHTML);
//     }
//   };

//   worker.onerror = (error) => {
//     console.error('Error in transformMarkdownWorker:', error);
//     // Fallback to inline processing if the worker fails
//     const processedQuestionsHTML = questionProcessor.processAllQuestions(); // Process all questions inline
//     console.log('Fallback processing complete:', processedQuestionsHTML);
//   };
// }


// OLD CODE
// // Initialize the worker.
    // const transformMarkdownWorker = new Worker(`${moduleParams.basePath}transformMarkdownWorker.js`, { type: 'module' });
    // transformMarkdownWorker.postMessage({ command: 'initialize' });
    
    // // Wait for the worker to initialize.
    // const workerReadyPromise = new Promise((resolve, reject) => {
    //     const timeout = setTimeout(() => {
    //         reject(new Error('Worker initialization timed out'));
    //     }, 2000); // Set timeout for worker initialization

    //     transformMarkdownWorker.onmessage = (event) => {
    //         if (event.data === 'ready') {
    //             clearTimeout(timeout);
    //             resolve();
    //         }
    //     };

    //     transformMarkdownWorker.onerror = (error) => {
    //         clearTimeout(timeout);
    //         reject(new Error(`Worker initialization failed: ${error.message}`));
    //     };
    // });
    // // If the worker fails to initialize, fallback to inline processing.
    // try {
    //     await workerReadyPromise;
    // } catch (error) {
    //     console.error('Error initializing transformMarkdownWorker. Fallback to inline processing:', error);
    //     transformMarkdownWorker.terminate();

    //     // TODO: now this needs to transform all questions in the background.
    //     //[contents, questName] = transformMarkdownToHTML(contents, precalculated_values, moduleParams.i18n, isEmbeddedSurvey);
    //     const retrievedData = await retrievedDataPromise;
    //     transformMarkdownToHTML(questionProcessor, isEmbeddedSurvey); // TODO: process all questions (the old method) in the background.
    //     return [questionProcessor, retrievedData];
    // }
