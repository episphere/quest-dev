export default {

    moduleName:                 /\"?name\"?\s*:[\s\"]*(\w+)[\s"]*[,}]/,
    loopGeneric:                /(<loop[\s\S]*?<\/loop>)/g,
    gridGeneric:                /(\|grid\|[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|[\s\S]*?\|)/g,
    gridSpecific:               /(\|grid\|id="([A-Z]+[A-Z0-9_]*)"|)/, //finish
    questionGeneric:            /(?=\[[A-Z]+[A-Z0-9_]*[!?]?(?:,.*)?\])/g,
    questionSpecific:           /\[([A-Z_]\w*)([?!])?\s*(?:[|,]\s*([^\]]+?))?\]([\s\S]*)/
}