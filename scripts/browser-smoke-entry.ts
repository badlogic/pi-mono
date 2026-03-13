import { complete, getModel } from "@apholdings/jensen-ai";

const model = getModel("google", "gemini-2.5-flash");
console.log(model.id, typeof complete);
