'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestMissingIngredientsInputSchema = z.object({
  recipe: z.string().describe('El nombre de la receta para la cual verificar los ingredientes faltantes. Por ejemplo: "Lomo Saltado", "Aji de Gallina".'),
  availableIngredients: z
    .array(z.string())
    .describe('Una lista de ingredientes que el usuario ya posee. Por ejemplo: ["cebolla", "tomate", "papas"].'),
});
export type SuggestMissingIngredientsInput = z.infer<
  typeof SuggestMissingIngredientsInputSchema
>;

const SuggestMissingIngredientsOutputSchema = z.object({
  missingIngredients: z
    .array(z.string().describe('Un solo ingrediente alimenticio faltante, tangible y comprable. Debe ser un sustantivo. Ejemplos: "pollo", "ají amarillo", "leche evaporada". No incluyas cantidades ni frases descriptivas como "al gusto" o "picado".'))
    .describe('Una lista de ingredientes alimenticios faltantes, concretos y comprables para la receta, basados en los ingredientes disponibles. No debe incluir métodos de cocción, frases descriptivas (ej: "al horno", "a la peruana", "picado", "en rodajas") ni cantidades.'),
});
export type SuggestMissingIngredientsOutput = z.infer<
  typeof SuggestMissingIngredientsOutputSchema
>;

export async function suggestMissingIngredients(
  input: SuggestMissingIngredientsInput
): Promise<SuggestMissingIngredientsOutput> {
  return suggestMissingIngredientsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestMissingIngredientsPrompt',
  input: {schema: SuggestMissingIngredientsInputSchema},
  output: {schema: SuggestMissingIngredientsOutputSchema},
  prompt: `Eres un asistente de cocina experto en identificar ingredientes faltantes para una receta específica, basándote en una lista de ingredientes que el usuario ya tiene.
Tu tarea es ser muy preciso y listar ÚNICAMENTE nombres de ingredientes alimenticios CONCRETOS, TANGIBLES y COMPRABLES que falten para completar la receta.

Receta: {{{recipe}}}
Ingredientes Disponibles:
{{#if availableIngredients}}
{{#each availableIngredients}}
- {{{this}}}
{{/each}}
{{else}}
- (Ninguno)
{{/if}}

Instrucciones Importantes:
1.  Analiza la receta y los ingredientes disponibles.
2.  Identifica qué ingredientes CLAVE de la receta NO están en la lista de "Ingredientes Disponibles".
3.  Devuelve una lista que contenga ÚNICAMENTE los NOMBRES de estos ingredientes alimenticios faltantes.
4.  CADA ELEMENTO en la lista 'missingIngredients' debe ser un SUSTANTIVO que represente un alimento o condimento específico (ej: "pollo", "ají amarillo", "leche evaporada", "comino", "arroz").
5.  NO INCLUYAS:
    *   Cantidades (ej: "2 unidades", "100 gramos").
    *   Adjetivos o frases descriptivas (ej: "fresco", "maduro", "picado", "en rodajas", "al gusto").
    *   Métodos de cocción o preparación (ej: "al horno", "frito", "a la peruana").
    *   Ingredientes que ya están listados como disponibles, incluso si la receta usa más cantidad. Solo lista lo que falta por completo.
    *   Frases genéricas o ambiguas.
6.  Si todos los ingredientes esenciales de la receta parecen estar disponibles, devuelve una lista vacía para 'missingIngredients'.
7.  Asegúrate de que el formato de salida sea un objeto JSON que cumpla estrictamente con el esquema de salida proporcionado.

Ejemplo de lo que NO hacer:
Si la receta es "Pollo al Horno" y el usuario tiene "pollo", NO sugieras "al horno" como ingrediente faltante.

Considera la receta y los ingredientes disponibles para generar la lista de ingredientes faltantes.
`,
config: {
    temperature: 0.2,
     safetySettings: [
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
    ],
  }
});

const suggestMissingIngredientsFlow = ai.defineFlow(
  {
    name: 'suggestMissingIngredientsFlow',
    inputSchema: SuggestMissingIngredientsInputSchema,
    outputSchema: SuggestMissingIngredientsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    if (!output) {
        console.error('suggestMissingIngredientsFlow: la generación no devolvió una salida válida.');
        return { missingIngredients: [] };
    }
    return output!;
  }
);
