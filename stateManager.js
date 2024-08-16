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

// TODO: not using listener pattern. Under consideration. Remove?

const createStateManager = (store, initialState = {}) => {
    // Set of listeners to notify when the state changes.
    const listeners = new Set(); // TODO: not using this. Remove?
    // The complete survey state with all questions.
    let surveyState = { ...initialState };
    // The active question state with the current question's responses.
    let activeQuestionState = {};
    // The the number of response keys for each question. Memoized to avoid re-calculating on each setFormValue call.
    let responseKeysObj = {};
    // Responses are mapped to question IDs for fast access on `exists` and other checks. { responseKey1 : questionIDkey1, responseKey2: questionIDkey2, etc. }
    let responseToQuestionMappingObj = {};
    // Cache found response values for faster access.
    let foundResponseCache = {};

    const notifyListeners = () => {
        listeners.forEach((listener) => listener(surveyState));
    }

    const stateManager = {
        setResponse: (questionID, key, numKeys, value) => {
            if (typeof key !== 'string') {
                throw new Error('StateManager -> setItem: Key must be a string');
            }

            // Construct the compound key and store the mapping
            const compoundKey = `${key}.${questionID}`;

            if (!responseToQuestionMappingObj[compoundKey]) {
                responseToQuestionMappingObj[compoundKey] = `${questionID}.${key}`;
            } else if (responseToQuestionMappingObj[compoundKey] !== `${questionID}.${key}`) {
                console.error(`Error: The responseKey "${key}" is already mapped to "${responseToQuestionMappingObj[compoundKey]}" and cannot be remapped to "${questionID}.${key}"`);
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

            // Cache the found response value for faster lookup access.
            foundResponseCache[compoundKey] = value;

            console.log('StateManager -> setResponse: activeQuestionState:', activeQuestionState);
            notifyListeners();
        },

        getItem: (questionID) => {
            if (typeof questionID !== 'string') {
                throw new Error('StateManager -> getItem: Key must be a string');
            }

            return surveyState[questionID];
        },

        removeResponseItem: (questionID, key, numKeys, elementValue) => {
            if (typeof questionID !== 'string') {
                throw new Error('StateManager -> removeItem: Key must be a string');
            }

            // Handle 'prefer not to answer' and 'not sure' types of responses where other responses are removed programmatically (and they don't exist yet).
            // Handle the cases for string, Array, and Object types.
            if (!activeQuestionState[questionID]) return;

            const compoundKey = `${key}.${questionID}`;

            switch (numKeys) {
                case 1:
                    if (Array.isArray(activeQuestionState[questionID])) {
                        activeQuestionState[questionID] = activeQuestionState[questionID].filter((val) => val !== elementValue);
                        
                        if (activeQuestionState[questionID].length === 0) {
                            activeQuestionState[questionID] = undefined;
                            delete responseToQuestionMappingObj[compoundKey];
                            delete foundResponseCache[compoundKey];
                        }
                    } else {
                        activeQuestionState[questionID] = undefined;
                        delete responseToQuestionMappingObj[compoundKey];
                        delete foundResponseCache[compoundKey];
                    }
                    break;

                default:
                    if (key && typeof activeQuestionState[questionID] === 'object') {
                        const value = activeQuestionState[questionID][key];

                        if (Array.isArray(value)) {
                            activeQuestionState[questionID][key] = value.filter((val) => val !== elementValue);

                            if (activeQuestionState[questionID][key].length === 0) {
                                activeQuestionState[questionID][key] = undefined;
                                delete responseToQuestionMappingObj[compoundKey];
                                delete foundResponseCache[compoundKey];
                            }
                        } else {                            
                            delete activeQuestionState[questionID][key];
                            delete responseToQuestionMappingObj[compoundKey];
                            delete foundResponseCache[compoundKey];

                            if (Object.keys(activeQuestionState[questionID]).length === 0) {
                                activeQuestionState[questionID] = undefined;
                            }
                        }
                    } else {
                        throw new Error('StateManager -> removeItem: Key not found');
                    }
                    break;
            }

            console.log('StateManager -> setResponse: activeQuestionState:', activeQuestionState);
            notifyListeners();
        },

        // Remove responses from the activeQuestionState. Triggered on 'back' button click.
        removeResponse: (questionID) => {
            if (typeof questionID !== 'string') {
                throw new Error('StateManager -> removeQuestion: Key must be a string');
            }

            // Get all response keys related to the questionID before setting it to undefined.
            // If it's an object, loop through each key and remove it from responseToQuestionObj. If it's a single value, remove it directly.
            if (activeQuestionState[questionID]) {
                if (typeof activeQuestionState[questionID] === 'object') {
                    for (const key in activeQuestionState[questionID]) {
                        const compoundKey = `${key}.${questionID}`;
                        delete responseToQuestionMappingObj[compoundKey];
                        delete foundResponseCache[compoundKey];
                    }
                } else {
                    delete responseToQuestionMappingObj[questionID];
                    delete foundResponseCache[questionID];
                }
            }

            activeQuestionState[questionID] = undefined;

            console.log('StateManager -> removeQuestion: activeQuestionState:', activeQuestionState);
            notifyListeners();
        },

        clearAllState: () => {
            surveyState = {};
            activeQuestionState = {};
            responseKeysObj = {};
            responseToQuestionMappingObj = {};
            foundResponseCache = {};
            notifyListeners();
        },

        // Set the active question state to the provided questionID. Important for: (1) return to survey and (2) 'Back' button click.
        setActiveQuestionState: (questionID) => {
            if (typeof questionID !== 'string') {
                throw new Error('StateManager -> setActiveQuestionState: Key must be a string');
            }

            if (surveyState.hasOwnProperty(questionID)) {
                activeQuestionState = { [questionID]: surveyState[questionID] };
                notifyListeners();
            }

            console.log('StateManager -> setActiveQuestionState: activeQuestionState:', activeQuestionState);
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
            responseToQuestionMappingObj = generateResponseKeyToQuestionIDMapping(surveyState);
            foundResponseCache = mapResponseKeysToCache(responseToQuestionMappingObj, surveyState);
        },

        // Sync changed items to the store alongside updated treeJSON. questionID is the form's id property.
        syncToStore: async () => {
            try {    
                activeQuestionState['treeJSON'] = updateTreeJSON();
                
                const changedState = {};
                Object.keys(activeQuestionState).forEach((key) => {
                    changedState[`${moduleParams.questName}.${key}`] = activeQuestionState[key];
                });

                if (typeof store === 'function') {
                    showLoadingIndicator();
                    await store(changedState);
                }
                
                surveyState = { ...surveyState, ...activeQuestionState };
                activeQuestionState = {};

                console.log('StateManager -> syncToStore: SURVEY STATE:', surveyState);
            } catch (error) {
                console.error('StateManager -> syncToStore: Error syncing state to store', error);
                throw error;
            } finally {
                hideLoadingIndicator();
            }
        },

        getCache: () => ({ ...foundResponseCache }),

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

        /**
         * ResponseKey is the same as the questionID for many questions, but it is mismatched in some cases.
         * @param {string} responseKey - the response input id (key)
         * @param {string} questionID - the question id (key) in the surveyState object
         * @returns {string|Array|Object} - the value of the response key in the surveyState object
         */

        findResponseValue: (responseKey, questionID = null) => {
            if (typeof responseKey !== 'string' || (questionID && typeof questionID !== 'string')) {
                throw new Error('StateManager -> findResponseValue: Key(s) must be strings');
            }

            const compoundKey = questionID
                ? `${responseKey}.${questionID}`
                : responseKey;

            // Check the cache first for a found response value.
            if (foundResponseCache.hasOwnProperty(compoundKey)) {
                console.log('RETURNING CACHE HIT:', foundResponseCache[compoundKey]); // Temp for debugging
                return foundResponseCache[compoundKey];
            }

            // Check if the responseKey is already in the surveyState object.
            const existingResponse = surveyState[compoundKey];
            if (existingResponse != null) {    
                let value;

                // If the value is a string, return it.
                if (typeof existingResponse === 'string') {
                    console.log('RETURNING VALUE (string):', compoundKey, existingResponse); // Temp for debugging
                    value = existingResponse;
                    
                // Checkbox groups are saved as arrays. If the value exists in the array, it was checked.
                } else if (Array.isArray(existingResponse)) {
                    console.log('RETURNING VALUE (array):', compoundKey, existingResponse); // Temp for debugging
                    value = existingResponse;
                
                // If the value is an object, it's stored as { key: { key: value }} return the value of the inner key.
                // There may be two inner keys. The unmatched key is for 'other' text fields and is not used in evaluation.
                } else if (typeof existingResponse === 'object') {
                    if (Object.keys(existingResponse).length === 1) {
                        console.log('RETURNING VALUE (one key in object):', compoundKey, existingResponse[Object.keys(existingResponse)[0]]); // Temp for debugging
                        value = existingResponse[Object.keys(existingResponse)[0]];
                    } else {
                        console.log('RETURNING VALUE (nested object):', compoundKey, existingResponse[compoundKey]); // Temp for debugging
                        value = existingResponse[compoundKey];
                    }
                }

                if (value != null) {
                    foundResponseCache[compoundKey] = value;
                    return value;
                }

                console.warn('RETURNING VALUE (UNHANDLED RESPONSE TYPE):', existingResponse);
                return existingResponse;
            }

            // If that fails, use the responseToQuestionMappingObj to find the full path to the value in surveyState.
            // Combine the responseKey and questionID if questionID is provided, then get the full path from the mapping object
            let pathToData;

            if (!questionID) {
                // TODO: TEMP FOR TESTING. Remove after testing.
                const foundKeyArray = Object.keys(responseToQuestionMappingObj).filter((key) => key.startsWith(compoundKey));
                if (foundKeyArray.length > 1) {
                    console.error('StateManager -> findResponseValue: (MULTIPLE FOUND - searching with startsWith):', compoundKey);
                }

                const foundKey = Object.keys(responseToQuestionMappingObj).find((key) => key.startsWith(compoundKey));
                if (!foundKey) {
                    console.warn('StateManager -> findResponseValue: (NOT FOUND - searching with startsWith):', compoundKey);
                    return undefined;
                }
                pathToData = responseToQuestionMappingObj[foundKey];
            } else {
                pathToData = responseToQuestionMappingObj[compoundKey];
            }
        
            if (!pathToData) return undefined;
        
            // Split the full path into parts. This is the path to the value in surveyState.
            const pathParts = pathToData.split('.');
            
            // Drill down into surveyState using the path parts to get the value.
            let value = surveyState;
            for (const part of pathParts) {
                value = value[part];
                if (value === undefined) {
                    return undefined;
                }
            }

            console.log('RETURNING VALUE (found by path):', compoundKey, value);
            foundResponseCache[compoundKey] = value;
            return value;
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
function updateTreeJSON() {
    return moduleParams.questName && questionQueue
        ? questionQueue.toJSON()
        : null;
}

/**
 * Map responses to question IDs for fast access on `exists` and other checks that doesn't involve DOM queries.
 * Resulting data structure: { responseKey1 : questionIDkey1, responseKey2: questionIDkey2, etc. }
 * This mapping is used to determine the question ID for a given response key for lookup in the surveyState object.
 * @param {Object} responseData - the response data from state.
 * @returns {Object} responseToQuestionMapping - the mapping of responses to question IDs.
 */

function generateResponseKeyToQuestionIDMapping(surveyState) {
    const responseToQuestionMapping = {};
    const visited = new Set();

    function traverse(obj, parentPath = []) {
        if (visited.has(obj)) {
            console.error('Error: Circular reference found in QuestionIDMapping -> traverse()');
            return;
        }
        visited.add(obj);

        for (const key in obj) {
            if (key === 'treeJSON') continue; // Skip the treeJSON key

            const value = obj[key];
            const currentPath = [...parentPath, key];
            
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                traverse(value, currentPath); // Recurse into nested objects
            } else {
                const responseKey = key;
                const fullPath = currentPath.join('.');

                // Generate the mapping key as "responseKey.fullPath"
                const uniqueKey = parentPath && parentPath.length > 0 ? `${responseKey}.${parentPath.join('.')}` : `${responseKey}`;

                if (responseToQuestionMapping[uniqueKey]) {
                    console.error(`Error: The responseKey "${uniqueKey}" is already mapped to "${responseToQuestionMapping[uniqueKey]}" and cannot be remapped to "${fullPath}"`);
                } else {
                    responseToQuestionMapping[uniqueKey] = fullPath;
                }
            }
        }
    }

    traverse(surveyState);

    return responseToQuestionMapping;
}

function mapResponseKeysToCache(responseToQuestionMappingObj) {
    const foundResponseCache = {};

    for (const key in responseToQuestionMappingObj) {
        if (key === 'treeJSON') continue; // Skip the treeJSON key

        const [responseKey, questionID] = key.split('.');
        const value = appState.findResponseValue(responseKey, questionID);

        if (value != null) {
            foundResponseCache[key] = value;
        }
    }

    return foundResponseCache;
}

/**
 * Create a new state manager with the provided store and initial state.
 * Flexible to allow for multiple state managers with various scoping in the future.
 */
export default createStateManager;
