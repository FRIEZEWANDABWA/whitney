import OpenAI from "openai";

const openaiApiKey = process.env.OPENAI_API_KEY || 'dummy_build_key';

// Initialize the OpenAI client for generating embeddings
export const openai = new OpenAI({
    apiKey: openaiApiKey,
});

/**
 * Helper function to generate an embedding for text using OpenAI's ADA model
 * @param text The text to embed
 * @returns number[] representing the embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    const response = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: text.replace(/\n/g, " "), // Replace newlines as recommended by OpenAI
    });

    return response.data[0].embedding;
}
