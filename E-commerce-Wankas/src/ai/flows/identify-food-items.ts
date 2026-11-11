'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const IdentifyFoodItemsInputSchema = z.object({
  photoDataUris: z
    .array(z.string())
    .min(1)
    .describe(
      "Un array de URIs de datos de fotos de alimentos. Cada URI debe incluir un tipo MIME y usar codificación Base64. Formato esperado: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type IdentifyFoodItemsInput = z.infer<typeof IdentifyFoodItemsInputSchema>;

const IdentifyFoodItemsOutputSchema = z.object({
  items: z.array(
    z.string().describe('Un alimento identificado en las imágenes, en ESPAÑOL.')
  ).describe('Lista de todos los alimentos identificados en las imágenes proporcionadas, con nombres en ESPAÑOL.')
});
export type IdentifyFoodItemsOutput = z.infer<typeof IdentifyFoodItemsOutputSchema>;

export async function identifyFoodItems(input: IdentifyFoodItemsInput): Promise<IdentifyFoodItemsOutput> {
  return identifyFoodItemsFlow(input);
}

const identifyFoodItemsFlow = ai.defineFlow(
  {
    name: 'identifyFoodItemsFlow',
    inputSchema: IdentifyFoodItemsInputSchema,
    outputSchema: IdentifyFoodItemsOutputSchema,
  },
  async (input: IdentifyFoodItemsInput) => {
    const instruction = `Eres un experto identificador de alimentos. Se te proporcionarán una o más imágenes.
Tu tarea es analizar CADA UNA de las siguientes imágenes. Identifica TODOS los alimentos visibles en TODAS las imágenes proporcionadas.
Devuelve los nombres de los alimentos exclusivamente en ESPAÑOL.
Combina todos los alimentos identificados en una ÚNICA lista en el campo "items".
Debes devolver SOLAMENTE un objeto JSON que cumpla estrictamente con el esquema de salida esperado. No incluyas ningún texto adicional antes o después del JSON.

Analiza las siguientes imágenes:`;

    const imageParts = input.photoDataUris.map(uri => ({ media: { url: uri } }));
    
    const promptParts: ({text: string} | {media: {url: string}})[] = [
      { text: instruction },
      ...imageParts,
    ];

    const { output } = await ai.generate({
      model: 'googleai/gemini-3.5-flash',
      prompt: promptParts,
      output: { schema: IdentifyFoodItemsOutputSchema }, 
      config: {
        temperature: 0.1, 
        safetySettings: [ 
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
        ],
      },
    });

    if (!output) {
      console.error('identifyFoodItemsFlow: la generación no devolvió una salida válida.');
      const err = new Error('La API de IA no devolvió una salida válida o la solicitud fue bloqueada.');
      throw err;
    }
    return output;
  }
);
