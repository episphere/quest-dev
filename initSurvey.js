import { transformMarkdownToHTML } from './transformMarkdownWorker.js';
import { math, moduleParams } from './questionnaire.js';
import { getStateManager, initializeStateManager } from './stateManager.js';

let questName = 'Questionnaire';

/**
 * Initialize the survey. Route the survey to the appropriate initialization function based on the renderObj configuration.
 * moduleParams.renderObj.activate determines if the survey is embedded in an application or found in the included rendering tool.
 * @param {String} contents - The markdown contents of the survey prior to transformation.
 * @returns {Array} - An array containing the transformed contents, questName, and retrievedData.
 */
export async function initSurvey(contents) {
    // Initialize the state manager. This will drive all data flow and UI updating in the app.
    initializeStateManager(moduleParams.renderObj.store);

    const precalculated_values = getPreCalculatedValues(contents);    
    return moduleParams.renderObj?.activate
        ? await initEmbeddedSurvey(contents, precalculated_values)
        : await initRendererSurvey(contents, precalculated_values);
}

/**
 * Initialize the survey for an embedded application.
 * @param {String} contents - The markdown contents of the survey prior to transformation.
 * @param {Object} precalculated_values - The precalculated values for the survey (values that aren't compatible with service worker calculation).
 * @returns {Array} - An array containing the transformed contents, questName, and retrievedData.
 */
async function initEmbeddedSurvey(contents, precalculated_values, isEmbeddedSurvey) {
    // TODO: THE !isDev (falsy) PATH SHOULD BE SET TO THE NEW CDN PATH FOR STAGE and PROD!!! (e.g. `https://cdn.jsdelivr.net/gh/episphere/quest-dev@v${moduleParams.renderObj?.questVersion}/`)
    // Set the base path for the module. This is used to fetch the stylesheets in init -> .
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.includes('github');
    moduleParams.basePath = !isLocalDev && moduleParams.renderObj?.questVersion
        ? 'https://episphere.github.io/quest-dev/'
        : './js/quest-dev/' //`https://episphere.github.io/quest-dev/`;
    
    // Fetch the resources for the survey. Await completion later in the routine.
    const retrievedDataPromise = fetchAndProcessResources();

    // Initialize the worker and wait for ready status.
    const transformMarkdownWorker = new Worker(`${moduleParams.basePath}transformMarkdownWorker.js`, { type: 'module' });
    transformMarkdownWorker.postMessage({ command: 'initialize' });
    
    const workerReadyPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Worker initialization timed out'));
        }, 2000); // Set timeout for worker initialization

        transformMarkdownWorker.onmessage = (event) => {
            if (event.data === 'ready') {
                clearTimeout(timeout);
                resolve();
            }
        };

        transformMarkdownWorker.onerror = (error) => {
            clearTimeout(timeout);
            reject(new Error(`Worker initialization failed: ${error.message}`));
        };
    });

    // Wait for the worker to initialize. If the worker fails to initialize, fallback to inline processing.
    try {
        await workerReadyPromise;
    } catch (error) {
        console.error('Error initializing transformMarkdownWorker. Fallback to inline processing:', error);
        transformMarkdownWorker.terminate();

        [contents, questName] = transformMarkdownToHTML(contents, precalculated_values, moduleParams.i18n, isEmbeddedSurvey);
        const retrievedData = await retrievedDataPromise;
        return [contents, questName, retrievedData];
    }

    // Post the transform command to the worker.
    transformMarkdownWorker.postMessage({ command: 'transform', data: [contents, precalculated_values, moduleParams.i18n, isEmbeddedSurvey] });

    const transformContentsWorkerPromise = new Promise((resolve) => {
        let isPromiseResolved = false;
        const timeout = setTimeout(() => {
            if (!isPromiseResolved) {
                const error = new Error('Worker timed out');
                transformMarkdownWorker.onerror(error);
            }
        }, 10000); // 10 seconds

        transformMarkdownWorker.onmessage = (messageResponse) => {
            if (!isPromiseResolved && messageResponse.data.command === 'transformDone') {
                clearTimeout(timeout);
                isPromiseResolved = true;

                [contents, questName] = messageResponse.data.result;

                transformMarkdownWorker.terminate();
                resolve();
            }
        };

        transformMarkdownWorker.onerror = (error) => {
            console.error('Error in transformMarkdownWorker. Fallback to inline processing:', error);

            if (!isPromiseResolved) {
                clearTimeout(timeout);
                isPromiseResolved = true;

                [contents, questName] = transformMarkdownToHTML(contents, precalculated_values, moduleParams.i18n, isEmbeddedSurvey);

                transformMarkdownWorker.terminate();
                resolve();
            }
        };
    });

    // Wait for the retrievedData fetch and worker completion.
    const [retrievedData] = await Promise.all([retrievedDataPromise, transformContentsWorkerPromise]);

    return [contents, questName, retrievedData];
}

/**
 * The renderer doesn't use the service worker, so processing is handled inline.
 * @param {String} contents - The markdown contents of the survey prior to transformation.
 * @param {Object} precalculated_values - The precalculated values for the survey.
 * @returns {Array} - An array containing the transformed contents, questName, and retrievedData.
 */
async function initRendererSurvey(contents, precalculated_values) {
    [contents, questName] = transformMarkdownToHTML(contents, precalculated_values, moduleParams.i18n);

    const retrievedData = null; // No retrieve function for the renderer and styling is referenced elsewhere (nothing to do here).
    return [contents, questName, retrievedData];
}

/**
 * Fetch and process the resources for the survey. This includes the retrieve function (existing user data) and CSS files.
 * See moduleParams.renderObj for the configuration (replace2.js).
 * @returns {Object} - The retrieved data from the retrieve function or null.
 */
async function fetchAndProcessResources() {
    // Helper function to unwrap the data from the retrieve function response. This format is necessary for fillForm().
    function unwrapData(data) {
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            const keys = Object.keys(data);
            if (keys.length === 1) {
                return data[keys[0]];
            }
        }
        return data;
    }
    
    try {
        const [retrieveFunctionResponse, cssActiveLogic, cssStyle1] = await Promise.all([
            moduleParams.renderObj?.retrieve && !moduleParams.renderObj?.surveyDataPrefetch ? moduleParams.renderObj.retrieve() : Promise.resolve(),
            moduleParams.renderObj?.url && moduleParams.renderObj?.activate ? fetch(`${moduleParams.basePath}ActiveLogic.css`).then(response => response.text()) : Promise.resolve(),
            moduleParams.renderObj?.url && moduleParams.renderObj?.activate ? fetch(`${moduleParams.basePath}Style1.css`).then(response => response.text()) : Promise.resolve(),
        ]);

        // retrievedData is the prefetched user data, the result of the retrieve function, or null (for the renderer or when no retrieve function is provided).
        // This is used to populate the questionnaire (fillForm).
        const retrievedData = moduleParams.renderObj?.surveyDataPrefetch || unwrapData(retrieveFunctionResponse?.data);

        // Add the stylesheets to the document.
        if (moduleParams.renderObj?.url && moduleParams.renderObj?.activate) {
            [cssActiveLogic, cssStyle1].forEach((css) => {
                const cssTextBlob = new Blob([css], { type: 'text/css' });
                const stylesheetLinkElement = document.createElement('link');
                stylesheetLinkElement.rel = 'stylesheet';
                stylesheetLinkElement.href = URL.createObjectURL(cssTextBlob);
                document.head.appendChild(stylesheetLinkElement);
            });
        }

        return retrievedData;
    } catch (error) {
        console.error('Error fetching retrieve function and css:', error);
        return null;
    }
}

/**
 * Pre-calculate values for the survey that don't work with the service worker.
 * Date operations and operations 'window' access are not compatible with the worker. Pre-calculate these values prior to worker access.
 * @param {String} contents - The markdown contents of the survey prior to transformation.
 * @returns {Object} - The precalculated values for the survey.
 */
function getPreCalculatedValues(contents) {

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