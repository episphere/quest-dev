import { questionQueue, moduleParams, rbAndCbClick, displayQuestion, submitQuestionnaire } from "./questionnaire.js";
import { restoreResults } from "./localforageDAO.js";
import { addEventListeners } from "./eventHandlers.js";
import { ariaLiveAnnouncementRegions, responseRequestedModal, responseRequiredModal, responseErrorModal, submitModal  } from "./common.js";
import { initSurvey } from "./initSurvey.js";


import en from "./i18n/en.js";
import es from "./i18n/es.js";

export let transform = function () {
  // init
};

transform.rbAndCbClick = rbAndCbClick

transform.render = async (obj, divId, previousResults = {}) => {

  // Set the moduleParams object with data needed for different parts of the app.
  moduleParams.renderObj = obj; // future todo: we have some duplication between moduleParams.obj, moduleParams.renderObj, and obj throughout the code.
  moduleParams.previousResults = previousResults;
  moduleParams.soccer = obj.soccer;
  moduleParams.delayedParameterArray = obj.delayedParameterArray;
  moduleParams.i18n = obj.lang === 'es' ? es : en;
  moduleParams.isWindowsEnvironment = isWindowsEnvironment();
  
  // if the object has a 'text' field, the contents have been prefetched and passed in. Else, fetch the survey contents.
  let contents = moduleParams.renderObj?.text || await fetch(moduleParams.renderObj?.url).then(response => response.text());
  if (moduleParams.renderObj?.url) moduleParams.config = contents;

  // Initialize the survey and transform the markdown contents to HTML.
  const [transformedContents, questName, retrievedData] = await initSurvey(contents);
  moduleParams.questName = questName;

  // add the HTML/HEAD/BODY tags...
  document.getElementById(divId).innerHTML = ariaLiveAnnouncementRegions() + transformedContents + responseRequestedModal() + responseRequiredModal() + responseErrorModal() + submitModal();

  // Get the active question from the tree and set it as active.
  function setActive(id) {
    let active = document.getElementById(id);
    if (!active) return;

    // remove active from all questions...
    Array.from(divElement.getElementsByClassName("active")).forEach(
      (element) => {
        console.log(`removing active from ${element.id}`);
        element.classList.remove("active");
      }
    );
    // make the id active...
    console.log(`setting ${id} active`);
    displayQuestion(active);
  }

  // If a user starts a module takes a break
  // and comes back...  get the tree out of the
  // local forage if it exists and fill out
  // the forms.  This functionality is needed
  // for the back/next functionality.
  async function fillForm() {
    // If the data is not prefetched and a retrieve function is provided, retrieve it.
    if (retrievedData) {
      delete retrievedData['784119588']; // TODO: this value is unhandled so far. Add it back in when languages are added.
      restoreResults(retrievedData);
    
      // If the data is not prefetched and a retrieve function is not provided, use localforage.  
    } else {
      let results = await localforage.getItem(moduleParams.questName);

      if (results == null) results = {};
      restoreResults(results);
    }
  }

  function resetTree() {
    // make the appropriate question active...
    // don't bother if there are no questions...
    if (questions.length > 0) {
      let currentId = questionQueue.currentNode.value;
      console.log("currentId", currentId);
      if (currentId) {
        console.log(` ==============>>>>  setting ${currentId} active`);
        setActive(currentId);
      } else {
        console.log(
          ` ==============>>>>  setting the first question ${questions[0].id} active`
        );

        // if the tree is empty add the first question to the tree...
        // and make it active...
        questionQueue.add(questions[0].id);
        questionQueue.next();
        setActive(questions[0].id);
      }
    }
  }
  
  let questions = [...document.getElementsByClassName("question")];
  let divElement = document.getElementById(divId);

  // wait for the objects to be retrieved,
  // then reset the tree.
  await fillForm();

  // get the tree from either 1) the client or 2) localforage..
  // either way, we always use the version in LF...
  if (obj.treeJSON) {
    questionQueue.loadFromJSON(obj.treeJSON)
  } else {
    await localforage.getItem(moduleParams.questName + ".treeJSON").then((tree) => {
      // if this is the first time the user attempt
      // the questionnaire, the tree will not be in
      // the localForage...
      if (tree) {
        questionQueue.loadFromVanillaObject(tree);
      } else {
        questionQueue.clear();
      }
      // not sure this is needed.  resetTree set it active...
      setActive(questionQueue.currentNode.value);
    });
  }

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
 
  [...divElement.querySelectorAll("[data-hidden]")].forEach((x) => {
    x.style.display = "none";
  });

  document.getElementById("submitModalButton").onclick = () => {
    let lastBackButton = document.getElementById('lastBackButton');
    if (lastBackButton) {
      lastBackButton.remove();
    }
    let submitButton = document.getElementById('submitButton');
    if (submitButton) {
      submitButton.remove();
    }
    submitQuestionnaire(moduleParams.renderObj.store, moduleParams.questName);
  };

  resetTree();
  
  if (moduleParams.soccer instanceof Function)
    moduleParams.soccer(); // "externalListeners" (PWA)

  // add an event listener to validate confirm...
  // if the user was lazy and used confirm instead of data-confirm, fix it now
  document.querySelectorAll("[confirm]").forEach( (element) => {
    element.dataset.confirm = element.getAttribute("confirm")
    element.removeAttribute("confirm")
  })
  document.querySelectorAll("[data-confirm]").forEach( (element) => {
    console.log(element.dataset.confirm)
    if (!document.getElementById(element.dataset.confirm)) {
      console.warn(`... cannot confirm ${element.id}. `)      
      delete element.dataset.confirm
    }
    let otherElement = document.getElementById(element.dataset.confirm)
    otherElement.dataset.conformationFor=element.id
  })

  // enable all popovers...
  const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]')
  const popoverList = [...popoverTriggerList].map(popoverTriggerEl => {
    console.log("... ",popoverTriggerEl)
    new bootstrap.Popover(popoverTriggerEl)
  })

  // All Global DOM processing is now complete (individual processing happens in displayQuestion()).
  // Add the event listeners to the parent div.
  addEventListeners(divElement);

  return true;
};

// Helper for accessibility features. Certain JAWS (Windows) and VoiceOver (Mac) features are handled differently by each platform.
// This detection helps optimize the user experience on each platform.
function isWindowsEnvironment() {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.indexOf("win") > -1;
}
