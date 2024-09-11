import { QuestionProcessor } from "./questionHandler.js";

self.onmessage = (event) => {
  if (event.data.command === 'initialize') {
    self.postMessage('ready');
  } else if (event.data.command === 'transform') {
    console.log('Received data (transform worker):', event.data.data);
    const [contents, precalculated_values, i18n, isEmbeddedSurvey] = event.data.data;
    //const transformResult = transformMarkdownToHTML(contents, precalculated_values, i18n, isEmbeddedSurvey);

    // const questionProcessor = new QuestionProcessor(contents, precalculated_values, i18n);
    // const questionsArray = questionProcessor.questions;
    // console.log('QUESTIONS ARRAY', questionsArray);
    // const questionDOM = questionProcessor.processQuestion(0);
    // console.log('QUESTION DOM', questionDOM);
    // //return [questionDOM, questName];
    
    self.postMessage({ command: 'transformDone', result: [questionDOM, questionProcessor.questName] });
  }
}

// This routine takes the markdown contents and converts it to HTML
// It's called from (1) the worker thread, (2) the worker's 'onerror' to process inline if the worker fails.
export function transformMarkdownToHTML(contents, precalculated_values, i18n) {

  const questionProcessor = new QuestionProcessor(contents, precalculated_values, i18n);
  const questionsArray = questionProcessor.questions;
  console.log('QUESTIONS ARRAY', questionsArray);
  const questName = questionProcessor.questName;

  const questionDOM = questionProcessor.processQuestion(0);
  //const questionDOM = questionProcessor.processAllQuestions();
  console.log('QUESTION DOM', questionDOM);
  return [questionDOM, questName];

}