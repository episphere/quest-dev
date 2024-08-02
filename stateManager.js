import { hideLoadingIndicator, moduleParams, questionQueue, showLoadingIndicator } from './questionnaire.js';
/**
 * State Manager: Quest state manager to centralize state management and syncing to the store.
 * appState is the global state container for the application.
 * It's initialized with the initial state and a store function for DB and UI management.
 */
let appState = null;

/**
 * Create a new state manager with the provided store and initial state.
 * The state manager is an object with survey data and methods to set, get, remove, and clear state.
 * @param {Function} store - the store function passed into Quest.
 * @param {Object} initialState - the initial state to be set in the state manager.
 * @returns {Object} stateManager - the state manager object and its methods.
 */
const createStateManager = (store, initialState = {}) => {
    // Set of listeners to notify when the state changes.
    const listeners = new Set(); // TODO: not using this. Remove?
    // The complete survey state with all questions.
    let surveyState = { ...initialState };
    // The active question state with the current question's responses.
    let activeQuestionState = {};
    // The the number of response keys for each question. Memoized to avoid re-calculating on each setFormValue call.
    let responseKeysObj = {};

    const notifyListeners = () => {
        listeners.forEach((listener) => listener(surveyState));
    }

    const stateManager = {
        setResponse: (questionID, key, numKeys, value) => {
            if (typeof key !== 'string') {
                throw new Error('StateManager -> setItem: Key must be a string');
            }

            switch (numKeys) {
                case 1:
                    activeQuestionState[questionID] = value;
                    break;
                default:
                    if (!activeQuestionState[questionID]) activeQuestionState[questionID] = {};
                    activeQuestionState[questionID][key] = value;
                    break;
            }

            console.log('CHANGED ITEMS - activeQuestionState:', activeQuestionState);

            notifyListeners();
        },

        getItem: (questionID) => {
            if (typeof questionID !== 'string') {
                throw new Error('StateManager -> getItem: Key must be a string');
            }

            return surveyState[questionID];
        },

        removeResponseItem: (questionID, key, numKeys) => {
            console.log('StateManager -> removeItem: questionID:', questionID, 'key:', key, 'numKeys:', numKeys);
            if (typeof questionID !== 'string') {
                throw new Error('StateManager -> removeItem: Key must be a string');
            }

            switch (numKeys) {
                case 1:
                    activeQuestionState[questionID] = undefined;
                    break;
                default:
                    if (key && activeQuestionState[questionID] && typeof activeQuestionState[questionID] === 'object') {
                        delete activeQuestionState[questionID][key];
                        if (Object.keys(activeQuestionState[questionID]).length === 0) {
                            activeQuestionState[questionID] = undefined;
                        }
                    } else {
                        throw new Error('StateManager -> removeItem: Key not found');
                    }
                    break;
            }

            notifyListeners();
        },

        // Remove responses from the activeQuestionState. Triggered on 'back' button click.
        removeResponse: (questionID) => {
            console.log('StateManager -> removeQuestion: questionID:', questionID);
            if (typeof questionID !== 'string') {
                throw new Error('StateManager -> removeQuestion: Key must be a string');
            }

            activeQuestionState[questionID] = undefined;
            notifyListeners();
        },

        clearAllState: () => {
            surveyState = {};
            activeQuestionState = {};
            notifyListeners();
        },

        clearActiveQuestionState: () => {
            activeQuestionState = {};
            notifyListeners();
        },

        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        getSurveyState: () => ({ ...surveyState }),

        getActiveQuestionState: () => ({...activeQuestionState}),

        loadInitialSurveyState: (retrievedData) => {
            const initialUserData = retrievedData || {};
            surveyState = { ...initialUserData };
        },

        // Sync changed items to the store alongside updated treeJSON. questionID is the form's id property.
        syncToStore: async () => {
            if (Object.keys(activeQuestionState).length === 0) {
                console.log('StateManager -> syncToStore: No changes to sync.');
                return;
            }

            try {    
                const changedState = {};
                changedState[`${moduleParams.questName}.treeJSON`] = updateTreeJSON();

                Object.keys(activeQuestionState).forEach((questionID) => {
                    changedState[`${moduleParams.questName}.${questionID}`] = activeQuestionState[questionID];
                });

                console.log('StateManager -> syncToStore: CHANGED STATE:', changedState);

                if (typeof store === 'function') {
                    showLoadingIndicator();
                    await store(changedState);
                }
                
                surveyState = { ...surveyState, ...changedState };
                activeQuestionState = {};
            } catch (error) {
                console.error('StateManager -> syncToStore: Error syncing state to store', error);
                throw error;
            } finally {
                hideLoadingIndicator();
            }
        },

        // Submit the survey by setting the COMPLETED flag to true and updating the COMPLETED_TS.
        submitSurvey: async () => {
            try {
                const changedState = {
                    [`${moduleParams.questName}.treeJSON`]: updateTreeJSON(),
                    [`${moduleParams.questName}.COMPLETED`]: true,
                    [`${moduleParams.questName}.COMPLETED_TS`]: new Date(),
                };
                
                if (typeof store === 'function') {
                    showLoadingIndicator();
                    await store(changedState);
                }

                surveyState = { ...surveyState, ...changedState };
                activeQuestionState = {};
            } catch (error) {
                console.error('StateManager -> submitSurvey: Error submitting survey', error);
                throw error;
            } finally {
                hideLoadingIndicator();
            }
        },

        // Set the num response keys for a question when the setFormValue function first triggers for the question.
        setNumResponseKeys: (key, value) => {
            responseKeysObj[key] = value;
        },

        // Get the num response keys for a question.
        getNumResponseKeys: (key) => {
            return responseKeysObj[key];
        },
    
        // Clear all keys other than the active key since displayif questions can change available responses for each key.
        clearOtherResponseKeys: (activeKey) => {
            for (const key in responseKeysObj) {
                if (key !== activeKey) {
                    delete responseKeysObj[key];
                }
            }
        },
    };

    return stateManager;
}

/**
 * Initialize the state manager with the provided store and initial state.
 * If the state manager has already been initialized, clear the state. This happens when the user clicks multiple surveys in a session.
 * @param {Function} store - the store function passed into Quest. 
 * @param {Object} initialState - the initial state to be set in the state manager.
 */
export function initializeStateManager(store, initialState = {}) {
    if (!appState) {
        appState = createStateManager(store, initialState);
    } else {
        appState.clearAllState();
    }
}

export function getStateManager() {
    if (!appState) {
        throw new Error('StateManager -> getStateManager: State manager has not been initialized. Call initializeStateManager() first.');
    }
    return appState;
}

// Update the tree in StateManager. This is called when the next button is clicked, before syncToStore().
// TODO: is treeJSON being handled correctly in stateManager across surveys?
// TODO: add error handling?
function updateTreeJSON() {
    return treeJSON = moduleParams.questName && questionQueue
        ? questionQueue.toJSON()
        : null;
}

/**
 * Create a new state manager with the provided store and initial state.
 * Flexible to allow for multiple state managers with various scoping in the future.
 */
export default createStateManager;
