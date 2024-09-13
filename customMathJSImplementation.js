import { getStateManager } from './stateManager.js';
import { create, all } from 'https://cdn.skypack.dev/pin/mathjs@v13.0.3-l5exVmFmmRoBpcv9HZ2w/mode=imports,min/optimized/mathjs.js';
export const math = create(all);

// Strip '_<num>' when an id that _0, _1, _2, etc. as a suffix.
export const stripIDSuffixRegex = /^([a-zA-Z0-9]+_[a-zA-Z0-9]+)_\d+$/

/**
 * YearMonth class for use in mathjs to handle the month class
 */
export class YearMonth {
  constructor(str) {
    if (str?.isYearMonth) {
      this.month = str.month;
      this.year = str.year;
    } else {
      let x = str.match(/^(\d+)-(\d+)$/);
      if (!x) {
        throw new Error("Invalid YearMonth format. Expected 'YYYY-MM'.");
      }
      this.month = parseInt(x[2]).toLocaleString(navigator.language, { minimumIntegerDigits: 2 });
      this.year = x[1];
    }
  }

  get isYearMonth() {
    return true;
  }

  toString() {
    return `${this.year}-${this.month}`;
  }

  add(n) {
    let m = parseInt(this.month) + n;
    let yr = parseInt(this.year) + ((m > 12) ? 1 : 0);
    let mon = (m % 12) || 12;
    return new YearMonth(`${yr}-${mon}`).toString();
  }

  subtract(n) {
    let m = parseInt(this.month) - n;
    let yr = parseInt(this.year) - ((m > 0) ? 0 : 1);
    let mon = ((m + 12) % 12) || 12;
    return new YearMonth(`${yr}-${mon}`).toString();
  }

  subMonth(ym) {
    return (12 * (parseInt(this.year) - parseInt(ym.year)) + parseInt(this.month) - parseInt(ym.month));
  }
}

export const customMathJSFunctions = {
  exists: function (x) {
    if (x == null || x === '') return false;

    if (x.toString().includes('.')) {
      return !math.isUndefined(this.getKeyedValue(x));
    }

    if (typeof x === 'number') return true;
    
    const existingResponse = this.appState.findResponseValue(x);

    switch (typeof existingResponse) {
      case 'object':
        return Array.isArray(existingResponse) ? existingResponse.length > 0 : Object.keys(existingResponse).length > 0;
      case 'string':
        return existingResponse.length > 0;
      case 'undefined':
        return false;
      default:
        console.error(`unhandled case in EXISTS check. Error: ${x} is not a valid response type.`);
        return false;
    }
  },

  doesNotExist: function (x) {
    return !this.exists(x)
  },

  noneExist: function (...ids) {
    // if you give me no ids, none of them exist therefore true...
    // loop through all the ids of any exists then return false...
    return ids.every(id => this.doesNotExist(id))
  },

  someExist: function (...ids) {
    return ids.some(id => this.exists(id))
  },

  allExist: function (...ids) {
    return ids.every(id => this.exists(id))
  },

  // TODO: remove this in favor of appState.findResponseValue()
  getKeyedValue: function(x) {
    console.warn('TODO: GET KEYED VALUE', x);
    const array = x.toString().split('.');
    const key = array.shift();
    const obj = this._value(key);
    
    // Return early if the initial object is undefined
    if (math.isUndefined(obj)) return undefined;
    
    return array.reduce((prev, curr) => {
      if (math.isUndefined(prev)) return undefined;
      return prev[curr] ?? undefined;
    }, obj);
  },

  _value: function (x) {
    if (!this.exists(x)) return null

    if (x.toString().includes('.')) return this.getKeyedValue(x);
    
    // x is a hardcoded number in some cases. E.g. valueOrDefault("D_378988419","D_807765962",125)
    if (typeof x === 'number') return x;

    return this.appState.findResponseValue(x);
  },

  valueEquals: function (id, value) {

    // if id is not passed in return FALSE
    if (this.doesNotExist(id)) return false;
    let element_value = this._value(id);

    // catch if we have a combobox...
    if (element_value[id]) {
      element_value = element_value[id]
    }

    // if the element does not exist return FALSE
    return (element_value == value)
  },

  equals: function(id, value){
    return this.valueEquals(id,value)
  },

  valueIsOneOf: function (id, ...values) {
    if (this.doesNotExist(id)) return false;
    // compare as strings so "1" == "1"
    values = values.map(v => v.toString())
    let test_values = math._value(id);

    // catch if we have a combobox...
    if (test_values[id]) {
      test_values = test_values[id]
    }

    if (Array.isArray(test_values)) {
      return (test_values.some(v => values.includes(v.toString())))
    }
    return values.includes(test_values.toString())
  },
  /**
   * checks whether the value for id is 
   * between the values of lowerLimit and upperLimit inclusively
   * lowerLimit <= value(id) <= upperlimit
   * 
   * if you pass in an array of ids, it uses the first id that exists.  The
   * array is passed into valueOrDefault.
   * 
   * @param  {Number} lowerLimit The lowest acceptable value
   * @param  {Number} upperLimit the highest acceptable value
   * @param  {Array}  ids   An array of values, passed into valueOrDefault.
   * @return {boolean}     is lowerLimit <= value(id) <= upperLimit
   */
  valueIsBetween: function (lowerLimit, upperLimit, ...ids) {
    if (lowerLimit === undefined || upperLimit === undefined || ids === undefined) return false;

    let value = undefined;
    value = (ids.length > 1) ? this.valueOrDefault(ids.shift(), ids) : this._value(ids.shift())
    // for this function to work, value, lowerLimit, and 
    // upperLimit MUST be numeric....
    if (!isNaN(value) && !isNaN(lowerLimit) && !isNaN(value)) {
      return (parseFloat(lowerLimit) <= value && value <= parseFloat(upperLimit))
    }
    return false
  },
  /**
   * Given a comma separated value of Conditions and values, returns a string of all the values that exist.
   * separated by a comma or the optional separator
   * 
   * i.e. existingValues(exists("ID1"),displaytext,exists("ID2"),displaytext)
   * 
   * @param  {args}  the args should be condition1, VAL1, condition2, VAL2, (optional)sep=,
   * 
   */
  existingValues: function (args) {
    if (!args) return ""

    let argArray = math.parse(args).args

    let sep = ", "
    if (argArray[argArray.length - 1].name == "sep") {
      sep = argArray.pop().evaluate()
    }
    // we better have (id/value PAIRS)
    argArray = argArray.reduce((prev, current, index, array) => {
      // skip the ids...
      if (index % 2 == 0) return prev

      // see if the id exists, if so keep the value
      if (array[index - 1].evaluate()) prev.push(this.valueOrDefault(current.evaluate(), current.evaluate()))

      return prev
    }, [])
    return argArray.join(sep)
  },

  // if the value of id is a string
  // return the string length, otherwise
  // return -1
  valueLength: function(id){
    // if id is not passed in return FALSE
    if (this.doesNotExist(id)) return false;
    let element_value = this._value(id);

    if (typeof element_value === 'string'){
      return element_value.length
    }
    return -1;
  },

  dateCompare: function (month1, year1, month2, year2) {
    if ([month1, month2].some((m) => { let m1 = parseInt(m); m1 < 0 || m1 > 11 })) {
      throw 'DateCompareError:months need to be from 0 (Jan) to 11 (Dec)'
    }

    if ([year1, year2].some((yr) => isNaN(yr))) {
      throw 'DateCompareError:years need to be numeric'
    }

    let date1 = (new Date(year1, month1)).getTime()
    let date2 = (new Date(year2, month2)).getTime()
    return (date1 < date2) ? -1 : (date1 == date2) ? 0 : 1
  },

  // Refactor once we have individual question DOM structure. Consider querying on init and storing in miscState. markdown func is 'noneSelected'.
  isSelected: function (id) {
    console.warn('TODO: (isSelected) update for single-question DOM structure', id);
    const match = id.match(stripIDSuffixRegex);
    if (!match || !match[1]) return false;
    
    const responseValue = this.appState.findResponseValue(match[1]);
    if (!responseValue) return false;

    const baseID = match[1];
    const cellInputValue = document.getElementById(id)
      ?.form
      ?.querySelector(`table tbody tr[data-question-id="${baseID}"] td[data-question-id="${baseID}"] input[id="${id}"]`)
      ?.value;

    if (!cellInputValue) {
      console.error('CELL INPUT VALUE NOT FOUND:', id);
      return false;
    }

    return cellInputValue === responseValue;
  },

  someSelected: function (...ids) { // TODO: test. this is impacted by the isSelected changes.
    return (ids.some(id => this.isSelected(id)))
  },

  noneSelected: function(...ids){
    return (!ids.some(id => this.isSelected(id)))
  },
  // defaultValue accepts an Id and a value or a Id/Value
  // If only 1 default value is given, first it looks it up
  // if it does not exist assume it is a value...
  // If 2 default values are given, look up the first, if it
  // does not exist, return the second as a value...
  valueOrDefault: function (x, ...defaultValue) {
    let v = this._value(x)

    let indx = 0;
    while (v == null && defaultValue.length > indx) {
      v = this._value(defaultValue[indx])
      if (v == null) indx++
    }
    
    if (v == null) v = defaultValue[defaultValue.length - 1]

    return (v);
  },

  selectionCount: function(x, countReset=false) {
    let [questionId, name] = x.split(':')
    name = name ?? questionId

    if (!this.exists(questionId)) return 0
    let responseValue = this._value(questionId);

    if (Array.isArray(responseValue) || Array.isArray(responseValue[name])) {
      responseValue = Array.isArray(responseValue) ? responseValue : responseValue[name]

      if (countReset){
        return responseValue.length;
      }

      console.warn('TODO: (selectionCount) remove DOM access and use stateManager', x);

      // BUG FIX:  if the data-reset ("none of the above") is selected
      let questionElement = document.getElementById(questionId)
      // there is a chance that nothing is selected (v.length==0) in that case you will the 
      // selector will find nothing.  Use the "?" because you cannot find the dataset on a null object.
      return questionElement.querySelector(`input[type="checkbox"][name="${name}"]:checked`)?.dataset["reset"]?0:responseValue.length
    }

    // if we want object to return the number of keys
    // Object.keys(v).length
    // otherwise:
    return 0;
  },
  // // For a question in a loop, does the value of the response
  // // for ANY ITERATION equal a value from a given set. 
  // loopQuestionValueIsOneOf: function (id, ...values) {
  //   // Loops append _n_n to the id, where n is an
  //   // integer starting from 1...
  //   for (let i = 1; ; i = i + 1) {
  //     let tmp_qid = `${id}_${i}_${i}`
  //     // the Id does not exist, we've gone through
  //     // all potential question and have not found
  //     // a value in the set of "acceptable" values...
  //     if (this.doesNotExist(tmp_qid)) return false;
  //     if (this.valueIsOneOf(tmp_qid, ...values)) return true
  //   }
  // },
  // gridQuestionsValueIsOneOf: function (gridId, ...values) {
  //   if (this.doesNotExist(gridId)) return false
  //   console.warn('TODO: (gridQuestionsValueIsOneOf) remove DOM access and use stateManager', gridId, ...values);
  //   let gridElement = document.getElementById(gridId) // TODO: rm DOM access, use stateManager
  //   if (! "grid" in gridElement.dataset) return false

  //   values = values.map(v => v.toString())
  //   let gridValues = this._value(gridId)
  //   for (const gridQuestionId in gridValues) {
  //     // even if there is only one value, force it into
  //     // an array.  flatten it to make sure that it's a 1-d array
  //     let test_values = [gridValues[gridQuestionId]].flat()
  //     if (test_values.some(v => values.includes(v.toString()))) {
  //       return true;
  //     }

  //   }
  //   return false;
  // },
  yearMonth: function (str) {
    let isYM = /^(\d+)\-(\d+)$/.test(str)
    if (isYM) {
      return new YearMonth(str)
    }
    let value = this._value(str)
    isYM = /^(\d+)\-(\d+)$/.test(value)
    if (isYM) {
      return new YearMonth(value)
    }
    return false;
  },

  YearMonth: YearMonth,
}

// Tell mathjs about the YearMonth class
math.typed.addType({
  name: 'YearMonth',
  test: function (x) {
    return x && x.isYearMonth
  }
})

// Add custom math.js handling for YearMonth
// Define string and number handling before adding the custom functions to mathjs.
const add = math.typed('add', {
  'YearMonth, number': function (dte, m) {
    return dte.add(m);
  },

  'number, YearMonth': function (m, dte) {
    return dte.add(m);
  },

  'number, number': function (a, b) { 
    return a + b; 
  },

  'string, string': function (a, b) {
    return parseFloat(a) + parseFloat(b);
  },

  'any, any': function (a, b) {
    return math.add(parseFloat(a), parseFloat(b));
  }
});

const subtract = math.typed('subtract', {
  'YearMonth, number': function (dte, m) {
    return dte.subtract(m);
  },

  'YearMonth, YearMonth': function (dte2, dte1) {
    return dte2.subMonth(dte1);
  },

  'number, number': function (a, b) { 
    return a - b; 
  },

  'string, string': function (a, b) {
    return parseFloat(a) - parseFloat(b);
  },

  'any, any': function (a, b) {
    return math.subtract(parseFloat(a), parseFloat(b));
  }
});

/**
 * Initialize the custom mathjs functions.
 * Add the custom functions to the customMathJSFunctions object.
 * Add the appState to the customMathJSFunctions object since it is used often.
 * Bind the custom functions to the customMathJSFunctions object (appState isn't a function, so it doesn't get bound).
 * Add the custom functions to mathjs and override any existing mathjs functions.
 */
export const initializeCustomMathJSFunctions = () => {
  customMathJSFunctions.add = add;
  customMathJSFunctions.subtract = subtract;
  customMathJSFunctions.appState = getStateManager();

  const boundFunctions = Object.keys(customMathJSFunctions).reduce((acc, key) => {
    if (typeof customMathJSFunctions[key] === 'function') {
      acc[key] = customMathJSFunctions[key].bind(customMathJSFunctions);
    } else {
      acc[key] = customMathJSFunctions[key];
    }
    return acc;
  }, {});

  math.import({ boundFunctions }, { override: true });
}
