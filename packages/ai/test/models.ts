import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

const ai = new GoogleGenAI({});

async function main() {
    /*let pager = await ai.models.list();
    do {
        for (const model of pager.page) {
            console.log(JSON.stringify(model, null, 2));
            console.log("---");
        }
        if (!pager.hasNextPage()) break;
        await pager.nextPage();
    } while (true);*/

    const openai = new OpenAI();
    const response = await openai.models.list();
    do {
        const page = response.data;
        for (const model of page) {
            const info = await openai.models.retrieve(model.id);
            console.log(JSON.stringify(model, null, 2));
            console.log("---");
        }
        if (!response.hasNextPage()) break;
        await response.getNextPage();
    } while (true);
}

await main();