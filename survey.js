export class Survey {
    
    constructor() {
        this.stack = [];
        this.currentQuestion = 0;
    };

    add(question) {
        this.stack.push(question);
    }

    first() {
        return this.stack[0];
    }

    last() {
        return this.stack[this.stack.length - 1];
    }

    current() {
        return this.stack[this.currentQuestion];
    }

    next() {
        this.currentQuestion++;
    }

    previous() {
        this.currentQuestion--;
    }
}