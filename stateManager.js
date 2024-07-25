import { hideLoadingIndicator, moduleParams, showLoadingIndicator } from './questionnaire.js';
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
    let state = { ...initialState };
    const listeners = new Set();
    const changedItems = new Set();

    const notifyListeners = () => {
        listeners.forEach((listener) => listener(state));
    }

    const stateManager = {
        setItem: (key, value) => {
            if (typeof key !== 'string') {
                throw new Error('StateManager -> setItem: Key must be a string');
            }
            
            state = { ...state, [key]: value };
            changedItems.add(key);
            notifyListeners();
        },

        getItem: (key) => {
            if (typeof key !== 'string') {
                throw new Error('StateManager -> getItem: Key must be a string');
            }
            return state[key];
        },

        removeItem: (key) => {
            if (typeof key !== 'string') {
                throw new Error('StateManager -> removeItem: Key must be a string');
            }
            const { [key]: removed, ...rest } = state;
            state = rest;
            changedItems.add(key);
            notifyListeners();
        },

        clear: () => {
            state = {};
            changedItems.clear();
            notifyListeners();
        },

        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        getState: () => ({ ...state }),

        getChangedItems: () => [...changedItems],

        loadInitialState: (retrievedData) => {
            const initialUserData = retrievedData || {};
            state = { ...state, ...initialUserData };
        },

        syncToStore: async () => {
            if (changedItems.size === 0) return;

            try {
                
                // show a loading indicator for variables in delayedParameterArray (they take extra time to process)
                if (moduleParams.delayedParameterArray.includes(nextElement.id)) showLoadingIndicator();
                
                const changedState = {};
                changedItems.forEach((key) => {
                    changedState[key] = state[key];
                });

                if (typeof store === 'function') await store(changedState);
                
                changedItems.clear();
            } catch (error) {
                console.error('StateManager -> syncToStore: Error syncing state to store', error);
                throw error;
            } finally {
                hideLoadingIndicator();
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
        appState = createStateManager(store, initialState = {});
    } else {
        appState.clear();
    }
}

export function getStateManager() {
    if (!appState) {
        throw new Error('StateManager -> getStateManager: State manager has not been initialized. Call initializeStateManager() first.');
    }
    return appState;
}

/**
 * Create a new state manager with the provided store and initial state.
 * Flexible to allow for multiple state managers with various scoping in the future.
 */
export default createStateManager;