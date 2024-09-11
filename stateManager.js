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
    // Set up the questionProcessor object
    let questionProcessor = null;

    function updateStateKey(value, questionID, key = null) {

        if (!activeQuestionState[questionID]) activeQuestionState[questionID] = {};
        
        if (key) {
            const compoundKey = `${key}.${questionID}`;
            activeQuestionState[questionID][key] = value;
            responseToQuestionMappingObj[compoundKey] = `${questionID}.${key}`;
            foundResponseCache[compoundKey] = value;
        } else {
            activeQuestionState[questionID] = value;
            responseToQuestionMappingObj[questionID] = questionID;
            foundResponseCache[questionID] = value;
        }
    }
    
    /**
     * Remove keys from activeQuestionState, mapping, and cache. Triggered on 'reset answer' click and, 'back' button click.
     * Also triggered when the only selected checkbox is unchecked (Including when text is removed from the 'other' text field in a checkbox).
     * 
     * @param {string} questionID - the question ID to delete from the state. Matches the formID.
     * @param {string} key - the response key for multi-value responses (checkboxes and text responses).
     * @param {boolean} removeMultipleKeys - whether to remove all keys for the questionID. This is used for multi-value responses when 'reset answer' or the 'back' button is clicked.
     * @returns {void}
     */
    function deleteStateKey(questionID, key = null, removeMultipleKeys = false) {

        if (!activeQuestionState[questionID]) return;

        if (typeof questionID !== 'string' || (key && typeof key !== 'string')) {
            console.error('StateManager -> deleteStateKey: Question ID and Key must be strings');
            return;
        }
    
        if ((key || removeMultipleKeys) && typeof activeQuestionState[questionID] !== 'object') {
            console.error('StateManager -> deleteStateKey: Expected object, got', typeof activeQuestionState[questionID]);
            return;
        }
        
        // Get all response keys related to the questionID before setting it to undefined.
        // If it's an object (and not an array), loop through each key and remove it from responseToQuestionObj. If it's a single value, remove it directly.
        if (removeMultipleKeys) {
            for (const key in activeQuestionState[questionID]) {
                const compoundKey = `${key}.${questionID}`;
                delete responseToQuestionMappingObj[compoundKey];
                delete foundResponseCache[compoundKey];
            }
            activeQuestionState[questionID] = undefined;

        // Clear one key in a multi-value response.
        } else if (key) {
            const compoundKey = `${key}.${questionID}`;
            activeQuestionState[questionID][key] = undefined;
            delete responseToQuestionMappingObj[compoundKey];
            delete foundResponseCache[compoundKey];
    
            if (Object.keys(activeQuestionState[questionID]).length === 0) {
                activeQuestionState[questionID] = undefined;
            }

        // Clear the single value response.
        } else {
            activeQuestionState[questionID] = undefined;
            delete responseToQuestionMappingObj[questionID];
            delete foundResponseCache[questionID];
        }
    }

    const stateManager = {
        // Set a response as the user updates form inputs. This is called on input change.
        // Single value responses are stored directly in the activeQuestionState object (case 1), multi-value responses are stored in an object (default case).
        setResponse: (questionID, key, numKeys, value) => {
            if (typeof questionID !== 'string' || typeof key !== 'string') {
                throw new Error('StateManager -> setItem: Question ID and Key must be strings');
            }

            // Check if the response is a single value or an object with multiple keys.
            // If it's a single value, store it directly in the activeQuestionState object under the questionID.
            // If it's an object, store it in the activeQuestionState object under the questionID and key.
            const shouldIncludeKey = numKeys > 1;
            
            if (value == null || value === '') {
                deleteStateKey(questionID, shouldIncludeKey ? key : null);
            } else {
                updateStateKey(value, questionID, shouldIncludeKey ? key : null);
            }
        
            console.log('StateManager -> setResponse: activeQuestionState:', activeQuestionState); // Temp for debugging
        },

        getItem: (questionID) => {
            if (typeof questionID !== 'string') {
                throw new Error('StateManager -> getItem: Key must be a string');
            }

            return surveyState[questionID];
        },

        // Handle 'prefer not to answer' and 'not sure' types of responses where other responses are removed programmatically (and they don't exist yet).
        // Handle the cases for string, Array, and Object types.
        removeResponseItem: (questionID, key, numKeys) => {
            if (typeof questionID !== 'string' || (key != null && typeof key !== 'string')) {
                throw new Error('StateManager -> removeItem: questionID and key must be strings');
            }
    
            if (!activeQuestionState[questionID]) return;

            // Check if the response is a single value or an object with multiple keys.
            // If it's a single value, store it directly in the activeQuestionState object under the questionID.
            // If it's an object, store it in the activeQuestionState object under the questionID and key.
            const includeKeyBool = numKeys > 1;

            // The array case and string cases are the same here. This only executes on the last array item (checkbox) removal.
            // If multiple checkboxes are selected, the operations are executed under setResponse().
            if (!includeKeyBool) {
                deleteStateKey(questionID);

            } else if (key && typeof activeQuestionState[questionID] === 'object') {
                deleteStateKey(questionID, key);

            } else {
                throw new Error('StateManager -> removeItem: Key not found');
            }

            console.log('StateManager -> removeResponseItem: activeQuestionState:', activeQuestionState); // Temp for debugging
        },

        // Remove responses from the activeQuestionState. Triggered on 'back' button click or 'reset answer' click.
        removeResponse: (questionID) => {
            if (typeof questionID !== 'string') {
                throw new Error('StateManager -> removeQuestion: questionID must be a string');
            }

            if (!activeQuestionState[questionID]) return;

            // Check if the response is a single value or an object with multiple keys.
            const removeMultipleKeysBool = typeof activeQuestionState[questionID] === 'object' && !Array.isArray(activeQuestionState[questionID]);
            deleteStateKey(questionID, null, removeMultipleKeysBool);
            
            console.log('StateManager -> removeResponse: activeQuestionState:', activeQuestionState); // Temp for debugging
        },

        clearAllState: () => {
            surveyState = {};
            activeQuestionState = {};
            responseKeysObj = {};
            responseToQuestionMappingObj = {};
            foundResponseCache = {};
            questionProcessor = null;
        },

        // Set the active question state to the provided questionID. Important for: (1) return to survey and (2) 'Back' button click.
        setActiveQuestionState: (questionID) => {
            if (typeof questionID !== 'string') {
                throw new Error('StateManager -> setActiveQuestionState: Key must be a string');
            }

            if (Object.prototype.hasOwnProperty.call(surveyState, questionID)) {
                activeQuestionState = { [questionID]: surveyState[questionID] };
            }
        },

        clearActiveQuestionState: () => {
            activeQuestionState = {};
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
                    
                    // TODO: update store function to return a response. Check response to handle errors & navigation.
                    /*const response = await*/ store(changedState);
                } else {
                    delete activeQuestionState['treeJSON'];
                }
                
                surveyState = { ...surveyState, ...activeQuestionState };
                activeQuestionState = {};

                console.log('StateManager -> syncToStore: SURVEY STATE:', surveyState); // Temp for debugging. NOTE: keep for renderer -> check with `if (!store)`
            } catch (error) {
                console.error('StateManager -> syncToStore: Error syncing state to store', error);
                throw error;
            } finally {
                hideLoadingIndicator();
            }
        },

        getResponseToQuestionMapping: () => ({ ...responseToQuestionMappingObj }),

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

        setQuestionProcessor: (processor) => {
            questionProcessor = processor;
        },

        getQuestionProcessor: () => {
            return questionProcessor;
        },

        // Set the num response keys for a question when the setFormValue function first triggers for the question.
        setNumResponseInputs: (key, value) => {
            responseKeysObj[key] = value;
        },

        // Get the num response keys for a question.
        getNumResponseInputs: (key) => {
            return responseKeysObj[key];
        },
    
        // Clear all keys other than the active key since displayif questions can change available responses for each key.
        clearOtherResponseInputEntries: (activeKey) => {
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

            // If the responseKey is a number, and not a conceptID, return it directly.
            if (!isNaN(parseFloat(responseKey)) && (responseKey < 100000000 || responseKey > 999999999)) {
                console.log('RETURNING (parseInt):', responseKey); // Temp for debugging
                return responseKey;
            }

            const compoundKey = questionID
                ? `${responseKey}.${questionID}`
                : responseKey;

            // Check the cache first for a found response value.
            if (Object.prototype.hasOwnProperty.call(foundResponseCache, compoundKey)) {
                return foundResponseCache[compoundKey];
            }

            // Check if the responseKey is already in the surveyState object.
            const existingResponse = surveyState[compoundKey];
            if (existingResponse != null) {    
                let value;

                // If the value is a string, return it.
                if (typeof existingResponse === 'string') {
                    console.log('RETURNING (string):', compoundKey, existingResponse); // Temp for debugging
                    value = existingResponse;
                    
                // Checkbox groups are saved as arrays. If the value exists in the array, it was checked.
                } else if (Array.isArray(existingResponse)) {
                    console.log('RETURNING (array):', compoundKey, existingResponse); // Temp for debugging
                    value = existingResponse;
                
                // If the value is an object, it's stored as { key: { key: value }} return the value of the inner key.
                // There may be two inner keys. The unmatched key is for 'other' text fields. Return the object when multiple keys exist. 
                } else if (typeof existingResponse === 'object') {
                    if (Object.keys(existingResponse).length === 1) {
                        console.log('RETURNING (one key in object):', compoundKey, existingResponse[Object.keys(existingResponse)[0]]); // Temp for debugging
                        value = existingResponse[Object.keys(existingResponse)[0]];
                    } else {
                        console.log('RETURNING (nested object):', compoundKey, existingResponse[compoundKey]); // Temp for debugging
                        value = existingResponse[compoundKey];
                    }
                }

                if (value != null) {
                    foundResponseCache[compoundKey] = value;
                    return value;
                }

                console.warn('RETURNING (default):', existingResponse); // Temp for debugging
                foundResponseCache[compoundKey] = existingResponse;
                return existingResponse;
            }

            // Check the previous results for known keys (these keys are accesesed on survey load for some surveys).
            if (Object.prototype.hasOwnProperty.call(moduleParams.previousResults, responseKey)) {
                console.log('RETURNING (previousResults):', responseKey, moduleParams.previousResults[responseKey]); // Temp for debugging
                return moduleParams.previousResults[responseKey].toString();
            }

            // If that fails, use the responseToQuestionMappingObj to find the full path to the value in surveyState.
            // Combine the responseKey and questionID if questionID is provided, then get the full path from the mapping object.
            let pathToData;
            let foundKey;

            if (!questionID) {
                // TODO: TEMP FOR TESTING. Ensure no conflicts with this method. Remove after testing.
                const foundKeyArray = Object.keys(responseToQuestionMappingObj).filter((key) => key.startsWith(compoundKey));
                if (foundKeyArray.length > 1) {
                    console.error('StateManager -> findResponseValue: (MULTIPLE FOUND - searching with startsWith):', compoundKey);
                }

                foundKey = Object.keys(responseToQuestionMappingObj).find((key) => key.startsWith(compoundKey));
                if (!foundKey) {
                    console.log('StateManager -> findResponseValue: (not found - searching with startsWith):', compoundKey); // Temp for debugging
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

            console.log('RETURNING (found by path):', foundKey ?? compoundKey, value); // Temp for debugging
            foundKey
                ? foundResponseCache[foundKey] = value
                : foundResponseCache[compoundKey] = value;
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

export function getStateManager(isRenderer = false) {
    if (!appState) {
        if (isRenderer) return null;
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

/**
 * Map the response keys to the cache for faster access. This especially helps with otherwise repetetive .startsWith() lookups in findResponseValue.
 * @param {Object} responseToQuestionMappingObj - the response to question ID mapping object.
 * @returns {Object} foundResponseCache - the cache of found response values.
 */
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
