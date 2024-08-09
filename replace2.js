import { questionQueue, moduleParams, rbAndCbClick, displayQuestion } from "./questionnaire.js";
import { restoreResponses } from "./restoreResponses.js";
import { addEventListeners } from "./eventHandlers.js";
import { ariaLiveAnnouncementRegions, responseRequestedModal, responseRequiredModal, responseErrorModal, submitModal  } from "./common.js";
import { initSurvey } from "./initSurvey.js";
import { getStateManager } from "./stateManager.js";

import en from "./i18n/en.js";
import es from "./i18n/es.js";

export let transform = function () {
  // init
};

transform.rbAndCbClick = rbAndCbClick

transform.render = async (obj, divId, previousResults = {}) => {
  console.log('RENDERING - LOCAL FORAGE REMOVAL Branch');

  // Set the global moduleParams object with data needed for different parts of the app.
  setModuleParams(obj, previousResults);
  
  // if the object has a 'text' field, the contents have been prefetched and passed in. Else, fetch the survey contents.
  const contents = moduleParams.renderObj?.text || await fetch(moduleParams.renderObj?.url).then(response => response.text());

  // Initialize the survey and transform the markdown contents to HTML.
  const [transformedContents, questName, retrievedData] = await initSurvey(contents);
  moduleParams.questName = questName;

  // Get the state manager and load the initial state. This prepares the state manager for use throughout the survey.
  const appState = getStateManager();
  appState.loadInitialSurveyState(retrievedData);
  const initialUserData = appState.getSurveyState();

  // add the HTML/HEAD/BODY tags...
  document.getElementById(divId).innerHTML = ariaLiveAnnouncementRegions() + transformedContents + responseRequestedModal() + responseRequiredModal() + responseErrorModal() + submitModal();

  // Load the question queue from the tree JSON.
  loadQuestionQueue(initialUserData?.treeJSON);

  // Get all the questions and the parent div element.
  const questions = [...document.getElementsByClassName("question")];
  const divElement = document.getElementById(divId);

  // Handle remaining DOM management (removing buttons, hiding elements, etc.).
  handleDOMManagement(questions, divElement);

  // Initialize the active question, activate it, and display it.
  const activeQuestionID = getActiveQuestionID(questions);
  const activeQuestionElement = setActiveQuestion(activeQuestionID, divElement);

  // If the active question is not found, and it's an embedded use case, log an error and return false.
  if (!activeQuestionElement && moduleParams.renderObj?.activate) {
    console.error('Active question not found for:', activeQuestionID);
    return false;
  }

  // Restore the user's existing survey response for the active question (if they exist). 
  restoreResponses(initialUserData, activeQuestionID);

  // Clear changed Items are cleared after the initial state is loaded.
  // This is to ensure that only the user's changes are tracked.
  appState.clearActiveQuestionState();

  // Display the active question.
  displayQuestion(activeQuestionElement);
  
  // If the soccer function is defined, call it. This is used for external listeners in the PWA.
  if (moduleParams.soccer instanceof Function) moduleParams.soccer();

  // All Global DOM processing is now complete (individual processing happens in displayQuestion()).
  // Add the event listeners to the parent div.
  addEventListeners(divElement);

  return true;
};

function setModuleParams(obj, previousResults) {
  moduleParams.renderObj = obj; // future todo: we have some duplication between moduleParams.obj, moduleParams.renderObj, and obj throughout the code.
  moduleParams.previousResults = previousResults;
  moduleParams.soccer = obj.soccer;
  moduleParams.delayedParameterArray = obj.delayedParameterArray;
  moduleParams.i18n = obj.lang === 'es' ? es : en;
  moduleParams.isWindowsEnvironment = isWindowsEnvironment();
  moduleParams.isFirefoxBrowser = isFirefoxBrowser();
}

// Load the question queue from the tree JSON. If the tree JSON is empty, ensure the question queue is cleared.
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

// Get the active question from the tree and set it as active. If the tree is empty add the first question to the tree and make it active.
function getActiveQuestionID(questions) {
  if (questions.length === 0) {
    if (!moduleParams.renderObj?.activate) console.error('No questions found in the survey.'); // TODO: handle eager execution inefficiency in renderer.
    return;
  }

  let currentQuestionID = questionQueue.currentNode.value;
  if (!currentQuestionID) {
    currentQuestionID = questions[0].id;
    questionQueue.add(currentQuestionID);
    questionQueue.next();
  }
  
  return currentQuestionID;
}

// Get the active question from the tree and set it as active.
function setActiveQuestion(questionID, divElement) {
  if (!questionID) return;

  const activeQuestion = document.getElementById(questionID);
  if (!activeQuestion) {
    console.error('Active question not found:', questionID);
    return;
  }

  // remove active from all questions.
  divElement.querySelectorAll('.active').forEach((element) => {
    element.classList.remove('active');
    console.log(`removing active from ${element.id}`);
  });

  // make the id active.
  activeQuestion.classList.add('active');
  console.log(`setting ${questionID} active and restoring responses`);

  return activeQuestion;
}

function handleDOMManagement(questions, divElement) {

  // remove the first 'previous' button and the final 'next' button.
  if (questions.length > 0) {
    let buttonToRemove = questions[0].querySelector(".previous");
    if (buttonToRemove) {
      buttonToRemove.remove();
    }
    buttonToRemove = [...questions].pop().querySelector(".next");
    if (buttonToRemove) {
      buttonToRemove.remove();
    }
  }

  // handle data-hidden elements
  [...divElement.querySelectorAll("[data-hidden]")].forEach((x) => {
    x.style.display = "none";
  });

  // validate confirm. If the confirm was used instead of data-confirm, fix it now
  document.querySelectorAll("[confirm]").forEach( (element) => {
    element.dataset.confirm = element.getAttribute("confirm")
    element.removeAttribute("confirm")
  });

  document.querySelectorAll("[data-confirm]").forEach( (element) => {
    console.log(element.dataset.confirm)
    if (!document.getElementById(element.dataset.confirm)) {
      console.warn(`... cannot confirm ${element.id}. `)      
      delete element.dataset.confirm
    }
    const otherElement = document.getElementById(element.dataset.confirm);
    otherElement.dataset.conformationFor=element.id;
  });

  // enable all popovers...
  const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
  [...popoverTriggerList].forEach(popoverTriggerEl => {
    new bootstrap.Popover(popoverTriggerEl);
  });
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
