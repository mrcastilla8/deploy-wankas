'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestRecipesInputSchema = z.object({
  ingredients: z
    .array(z.string())
    .describe('Una lista de ingredientes identificados (en español).'),
});
export type SuggestRecipesInput = z.infer<typeof SuggestRecipesInputSchema>;

const RecipeDetailSchema = z.object({
  recipeName: z.string().describe('El nombre de la receta sugerida en español.'),
  servings: z.number().int().min(1).describe('El número de porciones para el cual la receta está originalmente diseñada (ej: 2, 4).'),
  ingredients: z.array(z.string()).describe('Lista de ingredientes necesarios para la receta, en español. Incluye cantidades numéricas claras al inicio de cada ingrediente si es posible (ej: "2 papas amarillas...", "1/2 taza de...", "100 gramos de...").'),
  preparationSteps: z.array(z.string()).describe('Pasos detallados para la preparación de la receta, en español.'),
});

const SuggestRecipesOutputSchema = z.object({
  recipes: z
    .array(RecipeDetailSchema)
    .describe('Una lista de recetas detalladas sugeridas basadas en los ingredientes. Cada receta incluye nombre, porciones originales, ingredientes y pasos de preparación.'),
});
export type SuggestRecipesOutput = z.infer<typeof SuggestRecipesOutputSchema>;

export async function suggestRecipes(input: SuggestRecipesInput): Promise<SuggestRecipesOutput> {
  return suggestRecipesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestRecipesPrompt',
  input: {schema: SuggestRecipesInputSchema},
  output: {schema: SuggestRecipesOutputSchema},
  prompt: `Eres un experto chef especializado en cocina peruana e internacional.
Tu tarea es sugerir recetas detalladas basadas en la siguiente lista de ingredientes disponibles, de preferencia recetas peruanas.
Debes responder COMPLETAMENTE EN ESPAÑOL.

Ingredientes disponibles (estos están en español):
{{#each ingredients}}
- {{{this}}}
{{/each}}

Instrucciones:
1.  Analiza los ingredientes proporcionados.
2.  Sugiere entre 1 y 3 recetas.
3.  PRIORIZA recetas de la COCINA PERUANA. Si no es posible encontrar una receta peruana adecuada con los ingredientes, puedes sugerir recetas internacionales populares.
4.  Para cada receta sugerida, proporciona:
    a.  'recipeName': El nombre completo de la receta en español.
    b.  'servings': Un NÚMERO entero que indique para cuántas personas (porciones) está originalmente pensada la receta (ej: 2, 4). Este es el número base para la lista de ingredientes.
    c.  'ingredients': Una lista detallada de TODOS los ingredientes necesarios para la receta. IMPORTANTE: Para cada ingrediente, intenta comenzar la descripción con una CANTIDAD NUMÉRICA clara (ej: "2 papas amarillas...", "0.5 taza de ají...", "100 gramos de carne..."). Esto es crucial para el posterior escalado de la receta. La lista debe estar en español.
    d.  'preparationSteps': Una lista de los pasos de preparación numerados o en secuencia lógica, explicados claramente. La lista debe estar en español.
5.  Asegúrate de que el formato de salida sea un objeto JSON que cumpla estrictamente con el esquema de salida proporcionado. No incluyas ningún texto adicional antes o después del JSON. No uses markdown en el JSON.

Ejemplo de formato de salida esperado para UNA receta (debes devolver un array de estas en el campo 'recipes'):
{
  "recipeName": "Lomo Saltado",
  "servings": 4,
  "ingredients": [
    "500 gramos de lomo de res, cortado en tiras",
    "1 cebolla roja grande, cortada en juliana gruesa",
    "2 tomates, cortados en gajos",
    "1 ají amarillo, sin venas ni pepas, cortado en tiras",
    "0.25 taza de sillao (salsa de soja)",
    "2 cucharadas de vinagre tinto",
    "Cilantro picado al gusto",
    "Sal y pimienta al gusto",
    "Aceite vegetal",
    "Papas fritas para acompañar (cantidad al gusto)",
    "Arroz blanco cocido para acompañar (cantidad al gusto)"
  ],
  "preparationSteps": [
    "Sazona la carne con sal y pimienta.",
    "Calienta un wok o sartén grande a fuego alto con un poco de aceite. Saltea la carne hasta que esté dorada por fuera pero jugosa por dentro. Retira y reserva.",
    "En la misma sartén, añade un poco más de aceite si es necesario y saltea la cebolla y el ají amarillo hasta que estén ligeramente tiernos.",
    "Incorpora el tomate y saltea por un minuto más.",
    "Vuelve a agregar la carne a la sartén. Vierte el sillao y el vinagre. Cocina por un par de minutos, moviendo constantemente, hasta que la salsa espese ligeramente.",
    "Espolvorea con cilantro picado.",
    "Sirve inmediatamente acompañado de papas fritas y arroz blanco."
  ]
}

Considera los siguientes ingredientes para tus sugerencias: {{{ingredients}}}
`,
  config: { 
    temperature: 0.5, 
    safetySettings: [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
    ],
  }
});

const suggestRecipesFlow = ai.defineFlow(
  {
    name: 'suggestRecipesFlow',
    inputSchema: SuggestRecipesInputSchema,
    outputSchema: SuggestRecipesOutputSchema,
  },
  async input => {
    const { output } = await prompt(input);
    if (!output || !output.recipes || output.recipes.length === 0) {
      console.warn('suggestRecipesFlow: la generación no devolvió recetas.');
      return { recipes: [] };
    }
    return output;
  }
);
