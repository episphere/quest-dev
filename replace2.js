import { questionQueue, moduleParams, rbAndCbClick, displayQuestion, submitQuestionnaire, math } from "./questionnaire.js";
import { restoreResults } from "./localforageDAO.js";
import { addEventListeners } from "./eventHandlers.js";
import { responseRequestedModal, responseRequiredModal, responseErrorModal, submitModal  } from "./common.js";
import { transformMarkdownToHTML } from "./transformMarkdownWorker.js";

import en from "./i18n/en.js";
import es from "./i18n/es.js";

export let transform = function () {
  // init
};
transform.rbAndCbClick = rbAndCbClick

let questName = "Questionnaire";
let rootElement;

transform.render = async (obj, divId, previousResults = {}) => {  
  moduleParams.renderObj = obj; // future todo: we have some duplication between moduleParams.obj, moduleParams.renderObj, and obj throughout the code.
  moduleParams.previousResults = previousResults;
  moduleParams.soccer = obj.soccer;
  moduleParams.delayedParameterArray = obj.delayedParameterArray;
  moduleParams.i18n = obj.lang === 'es' ? es : en;
  moduleParams.isWindowsEnvironment = isWindowsEnvironment();

  rootElement = divId;

  // allow the client to reset the tree...
  
  // if the object has a 'text' field, the contents have been prefetched and passed in. Else, fetch the survey contents.
  let contents = moduleParams.renderObj?.text || await fetch(moduleParams.renderObj?.url).then(response => response.text());
  if (moduleParams.renderObj?.url) moduleParams.config = contents;

  // Date operations and operations accessing 'window' are not compatible with the worker. Prefetch them.
  const precalculated_values = getValuesForWorker();

  // Determine the path to thw worker and CSS files
  // TODO: NOTE: this local path is Joe's temporary setup with Quest-dev loaded in ConnectApp at connectApp/js/quest-dev for local development.
  const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const basePath = isLocalDev ? './js/quest-dev/' : './';

  // Create and dispatch the worker to transform 'contents' from markdown to HTML.
  console.time('transformWorker posted message response');
  const transformMarkdownWorker = new Worker(`${basePath}transformMarkdownWorker.js`, { type: 'module' });
  transformMarkdownWorker.postMessage([contents, precalculated_values, moduleParams.i18n]);

  // Fetch the retrieve function and css files.
  const [retrieveFunctionResponse, cssActiveLogic, cssStyle1] = await Promise.all([
    obj.retrieve && !obj.surveyDataPrefetch ? obj.retrieve() : Promise.resolve(),
    obj.url && obj.activate ? fetch(`${basePath}ActiveLogic.css`).then(response => response.text()) : Promise.resolve(),
    obj.url && obj.activate ? fetch(`${basePath}Style1.css`).then(response => response.text()) : Promise.resolve(),
  ]).catch((error) => {
    console.error('Error fetching retrieve function and css:', error);
  });

  // retrievedData is either the prefetched user data or the result of the retrieve function. This is used to populate the questionnaire (fillForm).
  const retrievedData = obj.surveyDataPrefetch || retrieveFunctionResponse.data;

  // Add the stylesheets to the document.
  if (obj.url && obj.activate) {
    [cssActiveLogic, cssStyle1].forEach((css) => {
      const cssTextBlob = new Blob([css], { type: 'text/css' });
      const stylesheetLinkElement = document.createElement('link');
      stylesheetLinkElement.rel = 'stylesheet';
      stylesheetLinkElement.href = URL.createObjectURL(cssTextBlob);
      document.head.appendChild(stylesheetLinkElement);
    });
  }

  // Post the message to the worker and update questName.
  // questName is the module ID. If none is provided, it defaults to 'Questionnaire'.
  // The worker will return the transformed contents and questName. The 'onerror' block falls back to inline processing.
  // The timeout is set to 10 seconds for handling an unresponsive worker.
  const transformContentsWorkerPromise = new Promise((resolve) => {
    let isPromiseResolved = false;
    const timeout = setTimeout(() => {
      if (!isPromiseResolved) {
        const error = new Error('Worker timed out');
        transformMarkdownWorker.onerror(error);
      }
    }, 10000); // 10 seconds

    transformMarkdownWorker.onmessage = (messageResponse) => {
      if (!isPromiseResolved) {
        clearTimeout(timeout);
        isPromiseResolved = true;

        console.timeEnd('transformWorker posted message response');
        [contents, questName] = messageResponse.data;
        moduleParams.questName = questName;

        transformMarkdownWorker.terminate();
        resolve();
      }
    }

    transformMarkdownWorker.onerror = (error) => {
      if (!isPromiseResolved) {
        clearTimeout(timeout)
        isPromiseResolved = true;

        console.timeEnd('transformWorker posted message response');
        console.error('Error in transformMarkdownWorker. Fallback to inline processing:', error);

        [contents, questName] = transformMarkdownToHTML(contents, moduleParams.i18n);
        moduleParams.questName = questName;

        transformMarkdownWorker.terminate();
        resolve();
      }
    }
  });

  // Await the worker's response with the transformed content. Now we have all data to continue rendering the questionnaire.
  await transformContentsWorkerPromise;

  // add the HTML/HEAD/BODY tags...
  document.getElementById(divId).innerHTML = contents + responseRequestedModal() + responseRequiredModal() + responseErrorModal() + submitModal();

  // Prefetch items that aren't compatible with the worker: Date operations and user variables that access the math package.
  function getValuesForWorker() {
    // Define the Date function dateToQuestFormat
    const dateToQuestFormat = (date) => {
      return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }

    const current_date = new Date();

    const precalculated_values = { 
      current_date: current_date,
      current_day: current_date.getDate(),
      current_month_str: moduleParams.i18n.months[current_date.getMonth()],
      current_month: current_date.getMonth() + 1,
      current_year: current_date.getFullYear(),
      quest_format_date: dateToQuestFormat(current_date),
    };

    // Find all user variables in the questText and add them to precalculated_values.
    [...contents.matchAll(/\{\$u:(\w+)}/g)].forEach(([match, varName]) => {
      precalculated_values[varName] = math._value(varName);
    });

    return precalculated_values;
  }

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
      let results = await localforage.getItem(questName);

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
    await localforage.getItem(questName + ".treeJSON").then((tree) => {
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
    submitQuestionnaire(moduleParams.renderObj.store, questName);
  };

  resetTree();
  
  if (moduleParams.soccer instanceof Function)
    moduleParams.soccer(); // "externalListeners" (PWA)
  moduleParams.questName = questName;


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

  // Add the event listeners to the parent div
  addEventListeners(divElement);

  return true;
};

function isWindowsEnvironment() {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.indexOf("win") > -1;
}
