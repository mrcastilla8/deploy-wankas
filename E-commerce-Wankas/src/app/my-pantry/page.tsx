'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { ImageUploader } from '@/components/image-uploader';
import { identifyFoodItems } from '@/ai/flows/identify-food-items';
import { suggestRecipes } from '@/ai/flows/suggest-recipes';
import { suggestMissingIngredients } from '@/ai/flows/suggest-missing-ingredients';
import { generateRecipeImage } from '@/ai/flows/generate-recipe-image';
import type { IdentifiedItem, Recipe, Product, IngredientActionItem } from '@/types';
import { getProducts } from '@/services/productService';
import { useCart } from '@/context/cart-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader } from '@/components/ui/loader';
import { useToast } from '@/hooks/use-toast';
import { Tag, ListChecks, UtensilsCrossed, PlusCircle, CheckSquare, ShoppingCart, UploadCloud, RefreshCw, ChefHat, BookOpen, Users, Soup, Apple, Loader2, X, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { useAuth } from '@/context/auth-context';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/context/locale-context';

enum PantryStep {
  Upload,
  Identified,
  Recipes,
  RecipeDetails,
}

const capitalizeFirstLetter = (string: string) => {
  if (!string) return string;
  return string.charAt(0).toUpperCase() + string.slice(1);
};

export default function MyPantryPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { translations } = useLocale();

  const [currentStep, setCurrentStep] = useState<PantryStep>(PantryStep.Upload);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingRecipeImage, setIsGeneratingRecipeImage] = useState(false);
  const [isFetchingMissingIngredients, setIsFetchingMissingIngredients] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualIngredients, setManualIngredients] = useState<string>('');
  const [additionalIngredient, setAdditionalIngredient] = useState<string>('');

  const [uploadedImageUris, setUploadedImageUris] = useState<string[]>([]);
  const [initialIdentifiedItems, setInitialIdentifiedItems] = useState<IdentifiedItem[]>([]);
  const [suggestedRecipes, setSuggestedRecipes] = useState<Recipe[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  
  const [missingIngredientsForRecipe, setMissingIngredientsForRecipe] = useState<IngredientActionItem[]>([]);
  const [availableIngredientsForRecipe, setAvailableIngredientsForRecipe] = useState<IngredientActionItem[]>([]);

  const [generatedRecipeImageUri, setGeneratedRecipeImageUri] = useState<string | null>(null);
  const [desiredServings, setDesiredServings] = useState<number>(1); 

  const { addToCart } = useCart();
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/my-pantry');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const fetchAllProducts = async () => {
      try {
        const productsData = await getProducts();
        setAllProducts(productsData);
      } catch (error) {
        console.error("Error al obtener productos para la despensa:", error);
        toast({ title: translations.common.error, description: translations.myPantryPage.productCatalogError, variant: 'destructive' });
      }
    };
    fetchAllProducts();
  }, [translations, toast]);

  const findProductMatch = (aiName: string): Product | undefined => {
    const lowerAiName = aiName.toLowerCase();
    let matchedProduct = allProducts.find(p => p.name.toLowerCase() === lowerAiName);
    if (!matchedProduct) {
      matchedProduct = allProducts.find(p => p.name.toLowerCase().includes(lowerAiName) || lowerAiName.includes(p.name.toLowerCase()));
    }
    if (!matchedProduct) {
        const aiNameParts = lowerAiName.split(/\s+/);
        matchedProduct = allProducts.find(p => 
            aiNameParts.some(part => p.name.toLowerCase().includes(part)) ||
            p.name.toLowerCase().split(/\s+/).some(productPart => lowerAiName.includes(productPart))
        );
    }
    return matchedProduct;
  };
  
  const handleImageUploaded = async (dataUris: string[]) => {
    setIsProcessing(true);
    setUploadedImageUris(dataUris);
    try {
      const result = await identifyFoodItems({ photoDataUris: dataUris });
      if (result.items && result.items.length > 0) {
        const identified = result.items.map(itemName => ({
          name: capitalizeFirstLetter(itemName), 
          aiOriginalName: itemName, 
          dbProduct: findProductMatch(itemName), 
          quantityToAddToCart: 1,
        }));
        setInitialIdentifiedItems(identified);
        setCurrentStep(PantryStep.Identified);
        setShowManualEntry(false);
        toast({ title: translations.myPantryPage.identifiedTitle, description: translations.myPantryPage.itemsFoundMsg.replace('{count}', result.items.length.toString()) });
      } else {
        toast({ title: translations.myPantryPage.noItemsIdentifiedTitle, description: translations.myPantryPage.noItemsIdentifiedDesc, variant: 'destructive' });
        setCurrentStep(PantryStep.Upload);
        setShowManualEntry(true);
      }
    } catch (error) {
      console.error('Error identificando alimentos:', error);
      let errorMsg = translations.myPantryPage.imageUploader.processingError;
      if (error instanceof Error && error.message.includes('blocked')) {
        errorMsg = translations.myPantryPage.imageUploader.blockedError;
      } else if (error instanceof Error) {
        errorMsg = error.message; 
      }
      toast({ title: translations.common.error, description: errorMsg, variant: 'destructive' });
      setCurrentStep(PantryStep.Upload);
      setShowManualEntry(true);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManualSubmit = () => {
    if (!manualIngredients.trim()) return;
    setIsProcessing(true);
    const items = manualIngredients.split(',').map(i => i.trim()).filter(i => i);
    const identified = items.map(itemName => ({
      name: capitalizeFirstLetter(itemName), 
      aiOriginalName: itemName, 
      dbProduct: findProductMatch(itemName), 
      quantityToAddToCart: 1,
    }));
    setInitialIdentifiedItems(identified);
    setCurrentStep(PantryStep.Identified);
    setShowManualEntry(false);
    setManualIngredients('');
    setIsProcessing(false);
  };

  const handleAddAdditionalIngredient = () => {
    if (!additionalIngredient.trim()) return;
    const items = additionalIngredient.split(',').map(i => i.trim()).filter(i => i);
    const newIdentified = items.map(itemName => ({
      name: capitalizeFirstLetter(itemName),
      aiOriginalName: itemName,
      dbProduct: findProductMatch(itemName),
      quantityToAddToCart: 1,
    }));
    setInitialIdentifiedItems(prev => [...prev, ...newIdentified]);
    setAdditionalIngredient('');
  };

  const handleRemoveIdentifiedItem = (indexToRemove: number) => {
    setInitialIdentifiedItems(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const handleGetRecipeSuggestions = async () => {
    if (initialIdentifiedItems.length === 0) {
      toast({ title: translations.common.noItems, description: translations.myPantryPage.noItemsForRecipe, variant: 'destructive' });
      return;
    }
    setIsProcessing(true);
    try {
      const result = await suggestRecipes({ ingredients: initialIdentifiedItems.map(item => item.name) });
      if (result.recipes && result.recipes.length > 0) {
        setSuggestedRecipes(result.recipes.map(r => ({ ...r, servings: r.servings > 0 ? r.servings : 1 })));
        setCurrentStep(PantryStep.Recipes);
        toast({ title: translations.myPantryPage.recipesSuggestedTitle, description: translations.myPantryPage.recipesFoundMsg.replace('{count}', result.recipes.length.toString()) });
      } else {
        toast({ title: translations.myPantryPage.noRecipesFoundTitle, description: translations.myPantryPage.noRecipesFoundDesc, variant: 'destructive'});
        setCurrentStep(PantryStep.Identified);
      }
    } catch (error) {
      console.error('Error sugiriendo recetas:', error);
      toast({ title: translations.common.error, description: translations.myPantryPage.pantryRecipeSuggestionError, variant: 'destructive' });
      setCurrentStep(PantryStep.Identified);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectRecipe = async (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    setDesiredServings(1);
    setGeneratedRecipeImageUri(null);
    setMissingIngredientsForRecipe([]);
    setAvailableIngredientsForRecipe([]); 
    setCurrentStep(PantryStep.RecipeDetails);

    setIsFetchingMissingIngredients(true);
    setIsGeneratingRecipeImage(true);

    const availableItemNamesFromPantry = initialIdentifiedItems.map(item => item.name);

    try {
      const missingResult = await suggestMissingIngredients({
        recipe: recipe.recipeName,
        availableIngredients: availableItemNamesFromPantry,
      });

      if (missingResult.missingIngredients) {
        const availableItemNamesLower = initialIdentifiedItems.map(item => item.name.toLowerCase());
        const trulyMissingNames = missingResult.missingIngredients.filter(
          missingName => {
            const lowerMissingName = missingName.toLowerCase();
            return missingName && missingName.trim() !== "" && !missingName.match(/\s(al|a la|de|para)\s/i) && 
                   !availableItemNamesLower.includes(lowerMissingName);
          }
        );

        const processedMissing = trulyMissingNames.map(aiName => {
            const matchedProduct = findProductMatch(aiName);
            return { aiName: capitalizeFirstLetter(aiName), dbProduct: matchedProduct, quantityToAddToCart: 1 };
          });
        setMissingIngredientsForRecipe(processedMissing);
        
        const foundInCatalogCount = processedMissing.filter(item => item.dbProduct).length;
        if (foundInCatalogCount > 0) {
            toast({ title: translations.myPantryPage.missingIngredientsIdentifiedMsg.replace('{recipeName}', recipe.recipeName).replace('{count}', foundInCatalogCount.toString()) });
        }
      }
    } catch (error) {
      console.error('Error sugiriendo ingredientes faltantes:', error);
      toast({ title: translations.common.error, description: translations.myPantryPage.pantryMissingIngredientsError, variant: 'destructive' });
    } finally {
      setIsFetchingMissingIngredients(false);
    }
    
    const currentAvailableForRecipe = initialIdentifiedItems
      .filter(item => item.dbProduct) 
      .map(item => ({
        aiName: item.name, 
        dbProduct: item.dbProduct, 
        quantityToAddToCart: 1, 
    }));
    setAvailableIngredientsForRecipe(currentAvailableForRecipe);

    try {
      const imageResult = await generateRecipeImage({ recipeName: recipe.recipeName });
      setGeneratedRecipeImageUri(imageResult.imageDataUri);
    } catch (error) {
      console.error('Error generando imagen de receta:', error);
      setGeneratedRecipeImageUri(null); 
    } finally {
      setIsGeneratingRecipeImage(false);
    }
  };
  
  const handleIngredientQuantityChange = (listType: 'missing' | 'available', identifier: string, value: string) => {
      if (value !== '' && (!/^\d+$/.test(value) || value.startsWith('0'))) {
        return;
      }

      const updateList = (prev: IngredientActionItem[]) =>
        prev.map(item => {
          if (item.aiName === identifier) {
            const num = value === '' ? 0 : parseInt(value, 10);
            return { ...item, quantityToAddToCart: num };
          }
          return item;
        });

      if (listType === 'missing') {
        setMissingIngredientsForRecipe(updateList);
      } else {
        setAvailableIngredientsForRecipe(updateList);
      }
  };

  const handleIngredientQuantityBlur = (listType: 'missing' | 'available', identifier: string) => {
    const list = listType === 'missing' ? missingIngredientsForRecipe : availableIngredientsForRecipe;
    const setter = listType === 'missing' ? setMissingIngredientsForRecipe : setAvailableIngredientsForRecipe;
    
    const itemToUpdate = list.find(i => i.aiName === identifier);
    if (!itemToUpdate) return;

    let finalQuantity = itemToUpdate.quantityToAddToCart;
    const stock = itemToUpdate.dbProduct?.stock ?? Infinity;

    if (isNaN(finalQuantity) || finalQuantity < 1) {
      finalQuantity = 1;
    } else if (stock && finalQuantity > stock) {
      finalQuantity = stock;
       toast({
        title: translations.productPage.onlyLeft.replace('{stock}', String(stock)),
        variant: 'destructive',
      });
    } else {
      finalQuantity = Math.floor(finalQuantity);
    }

    if (finalQuantity !== itemToUpdate.quantityToAddToCart) {
      setter(prev =>
        prev.map(item =>
          item.aiName === identifier ? { ...item, quantityToAddToCart: finalQuantity } : item
        )
      );
    }
  };


  const handleAddIngredientToCart = (item: IngredientActionItem) => {
    if (item.dbProduct) {
      addToCart(item.dbProduct, item.quantityToAddToCart);
    } else {
      toast({ title: translations.common.error, description: translations.myPantryPage.productNotInCatalog.replace('{ingredientName}', item.aiName), variant: 'destructive' });
    }
  };

  const resetPantryProcess = () => {
    setCurrentStep(PantryStep.Upload);
    setUploadedImageUris([]);
    setInitialIdentifiedItems([]);
    setSuggestedRecipes([]);
    setSelectedRecipe(null);
    setMissingIngredientsForRecipe([]);
    setAvailableIngredientsForRecipe([]);
    setGeneratedRecipeImageUri(null);
    setIsProcessing(false);
    setIsGeneratingRecipeImage(false);
    setIsFetchingMissingIngredients(false);
    setDesiredServings(1);
    setShowManualEntry(false);
    setManualIngredients('');
  };

  const scaleIngredient = (ingredient: string, originalServings: number, newServings: number): string => {
    if (originalServings <= 0 || newServings === originalServings) return ingredient;
    const scaleFactor = newServings / originalServings;

    return ingredient.replace(/^(\d+(\.\d+)?|\d+\s*\/\s*\d+|\d+)\s*/, (match) => {
      const quantityStr = match.trim();
      let quantity: number;

      if (quantityStr.includes('/')) { 
        const parts = quantityStr.split('/').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[1] !== 0) {
          quantity = parts[0] / parts[1];
        } else {
          return match; 
        }
      } else {
        quantity = parseFloat(quantityStr);
      }
      
      if (isNaN(quantity)) return match; 
      
      const newQuantity = quantity * scaleFactor;
      
      if (newQuantity < 0.1 && newQuantity > 0) {
        return ingredient; 
      }
      const formattedNewQuantity = Number.isInteger(newQuantity) ? newQuantity.toString() : parseFloat(newQuantity.toFixed(1)).toString();
      return `${formattedNewQuantity} `;
    });
  };
  
  const scaledIngredients = useMemo(() => {
    if (!selectedRecipe || !selectedRecipe.ingredients) return [];
    const originalServings = selectedRecipe.servings > 0 ? selectedRecipe.servings : 1; 
    return selectedRecipe.ingredients.map(ing => scaleIngredient(ing, originalServings, desiredServings));
  }, [selectedRecipe, desiredServings]);


  if (authLoading || (allProducts.length === 0 && currentStep !== PantryStep.Upload && !isProcessing && !isGeneratingRecipeImage && !isFetchingMissingIngredients)) {
    return <div className="flex items-center justify-center min-h-[calc(100vh-10rem)]"><Loader text={translations.common.loading} size={48}/></div>;
  }
  if (!user && !authLoading) return null;


  const renderStepContent = () => {
    switch (currentStep) {
      case PantryStep.Upload:
        return (
          <Card className="shadow-xl">
            <CardHeader>
              <CardTitle className="font-headline text-2xl flex items-center">
                <UploadCloud className="mr-2 h-7 w-7 text-primary" /> {translations.myPantryPage.uploadTitle}
              </CardTitle>
              <CardDescription>{translations.myPantryPage.uploadDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <ImageUploader onImageUpload={handleImageUploaded} isProcessing={isProcessing} />
              {showManualEntry && (
                <div className="mt-6 p-4 border rounded-md bg-secondary/10 animate-fadeIn">
                  <h4 className="font-semibold mb-2 flex items-center">
                    <ListChecks className="mr-2 h-5 w-5 text-primary" /> Ingreso manual de ingredientes
                  </h4>
                  <p className="text-sm text-muted-foreground mb-4">Ingresa los ingredientes separados por comas si la IA no pudo identificarlos o hubo un error.</p>
                  <Input 
                    placeholder="Ej: Tomate, Cebolla, Ajo, Pollo" 
                    value={manualIngredients} 
                    onChange={(e) => setManualIngredients(e.target.value)}
                    disabled={isProcessing}
                    className="mb-4"
                  />
                  <Button onClick={handleManualSubmit} disabled={isProcessing || !manualIngredients.trim()} className="w-full sm:w-auto">
                    Continuar con estos ingredientes
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );

      case PantryStep.Identified:
        return (
          <Card className="shadow-xl animate-fadeIn">
            <CardHeader>
              <CardTitle className="font-headline text-2xl flex items-center">
                <Tag className="mr-2 h-7 w-7 text-primary" /> {translations.myPantryPage.identifiedTitle}
              </CardTitle>
              <CardDescription>{translations.myPantryPage.identifiedDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              {uploadedImageUris.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                    {uploadedImageUris.map((uri, index) => (
                        <div key={index} className="relative aspect-square rounded-lg overflow-hidden shadow-md">
                            <Image src={uri} alt={`${translations.myPantryPage.imageUploader.imagePreviewAlt} ${index + 1}`} fill style={{ objectFit: 'cover' }} />
                        </div>
                    ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2 mb-4">
                {initialIdentifiedItems.map((item, index) => (
                  <Badge key={index} variant="secondary" className="text-md p-2 pl-3 bg-accent/20 text-primary flex items-center gap-1">
                    {item.name}
                    <button 
                      onClick={() => handleRemoveIdentifiedItem(index)}
                      className="text-primary hover:text-destructive hover:bg-destructive/10 rounded-full p-0.5 transition-colors"
                      title="Eliminar ingrediente"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-2 mb-6 bg-secondary/10 p-3 rounded-md border">
                <Input 
                  placeholder="Agregar ingrediente omitido (ej. Aceite, Sal)"
                  value={additionalIngredient}
                  onChange={(e) => setAdditionalIngredient(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddAdditionalIngredient()}
                  className="flex-1 bg-background"
                />
                <Button 
                  onClick={handleAddAdditionalIngredient} 
                  variant="secondary" 
                  disabled={!additionalIngredient.trim()}
                  className="shrink-0"
                >
                  <Plus className="mr-2 h-4 w-4" /> Agregar
                </Button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleGetRecipeSuggestions} disabled={isProcessing || initialIdentifiedItems.length === 0} className="flex-1">
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      {translations.common.loading}...
                    </>
                  ) : (
                    <>
                      <ListChecks className="mr-2 h-5 w-5" />
                      {translations.buttons.getRecipeSuggestions}
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={resetPantryProcess}>
                  <RefreshCw className="mr-2 h-4 w-4" /> {translations.buttons.startOver}
                </Button>
              </div>
            </CardContent>
          </Card>
        );

      case PantryStep.Recipes:
        return (
          <Card className="shadow-xl animate-fadeIn">
            <CardHeader>
              <CardTitle className="font-headline text-2xl flex items-center">
                <ListChecks className="mr-2 h-7 w-7 text-primary" /> {translations.myPantryPage.recipeSuggestionsTitle}
              </CardTitle>
              <CardDescription>{translations.myPantryPage.recipeSuggestionsDesc}</CardDescription>
            </CardHeader>
            <CardContent>
              {isProcessing && <Loader text={translations.myPantryPage.fetchingRecipes}/>}
              {!isProcessing && suggestedRecipes.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  {suggestedRecipes.map((recipe) => (
                    <Button
                      key={recipe.recipeName}
                      variant="outline"
                      className="p-4 h-auto text-left justify-start hover:bg-primary/10 hover:border-primary items-start"
                      onClick={() => handleSelectRecipe(recipe)}
                      disabled={isProcessing || isGeneratingRecipeImage || isFetchingMissingIngredients}
                    >
                      <ChefHat className="mr-3 h-5 w-5 text-accent shrink-0 mt-1" />
                      <span className="font-medium whitespace-normal break-words">{recipe.recipeName}</span>
                    </Button>
                  ))}
                </div>
              )}
              {!isProcessing && suggestedRecipes.length === 0 && (
                <p className="text-center text-muted-foreground">{translations.myPantryPage.noRecipesFoundDesc}</p>
              )}
              <Button variant="outline" onClick={() => setCurrentStep(PantryStep.Identified)} className="w-full mt-4"  disabled={isProcessing || isGeneratingRecipeImage || isFetchingMissingIngredients}>{translations.buttons.backToIdentified}</Button>
            </CardContent>
          </Card>
        );

      case PantryStep.RecipeDetails:
        if (!selectedRecipe) return <Loader text={translations.common.loading}/>;
        
        const catalogMissingIngredients = missingIngredientsForRecipe.filter(item => item.dbProduct);
        const uncataloguedAiSuggestions = missingIngredientsForRecipe.filter(item => !item.dbProduct).map(item => item.aiName);
        
        return (
          <Card className="shadow-xl animate-fadeIn">
            <CardHeader>
              <CardTitle className="font-headline text-2xl flex items-center">
                <BookOpen className="mr-2 h-7 w-7 text-primary" /> {selectedRecipe.recipeName}
              </CardTitle>
              <CardDescription>
                {translations.myPantryPage.recipeDetailsDesc.replace('{recipeName}', selectedRecipe.recipeName)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row items-center gap-4 mb-4 p-4 border rounded-md bg-secondary/20">
                <Label htmlFor="servings-input" className="text-md font-medium flex items-center whitespace-nowrap">
                  <Users className="mr-2 h-5 w-5 text-primary" />
                  {translations.myPantryPage.scaleRecipeServingsLabel}:
                </Label>
                <Input
                  id="servings-input"
                  type="number"
                  value={desiredServings}
                  onChange={(e) => setDesiredServings(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  className="w-20 h-9 text-center"
                />
                <span className="text-sm text-muted-foreground">({translations.myPantryPage.originalServingsLabel}: {selectedRecipe.servings > 0 ? selectedRecipe.servings : 1})</span>
              </div>

              {isGeneratingRecipeImage && <div className="mb-4"><Loader text={translations.myPantryPage.generatingRecipeImage} /></div>}
              {generatedRecipeImageUri && !isGeneratingRecipeImage && (
                <div className="mb-6 text-center">
                  <div className="relative w-full max-w-md h-64 mx-auto rounded-lg overflow-hidden shadow-md">
                    <Image src={generatedRecipeImageUri} alt={translations.myPantryPage.recipeImageFor.replace('{recipeName}', selectedRecipe.recipeName)} fill style={{ objectFit: 'cover' }} />
                  </div>
                </div>
              )}
              {!generatedRecipeImageUri && !isGeneratingRecipeImage && (
                <div className="mb-6 text-center">
                   <div className="relative w-full max-w-md h-64 mx-auto rounded-lg overflow-hidden shadow-md bg-muted flex items-center justify-center">
                    <UtensilsCrossed className="h-16 w-16 text-muted-foreground"/>
                   </div>
                </div>
              )}

              <div>
                <h4 className="font-headline text-lg font-semibold mb-2 flex items-center"><Soup className="mr-2 h-5 w-5 text-primary"/>{translations.myPantryPage.ingredientsListTitle} ({translations.myPantryPage.forServingsLabel.replace('{count}', desiredServings.toString())})</h4>
                <ul className="list-disc list-inside space-y-1 pl-4 text-sm bg-secondary/30 p-4 rounded-md">
                  {scaledIngredients.map((ing, index) => <li key={index}>{ing}</li>)}
                </ul>
              </div>

              <div>
                <h4 className="font-headline text-lg font-semibold mb-2">{translations.myPantryPage.preparationStepsTitle}</h4>
                <ol className="list-decimal list-inside space-y-2 pl-4 text-sm bg-secondary/30 p-4 rounded-md">
                  {selectedRecipe.preparationSteps.map((step, index) => <li key={index}>{step}</li>)}
                </ol>
              </div>
              
              {isFetchingMissingIngredients && <div className="mt-4"><Loader text={translations.myPantryPage.fetchingMissingIngredients} /></div>}

              {!isFetchingMissingIngredients && availableIngredientsForRecipe.length > 0 && (
                <div className="pt-4 border-t">
                  <h4 className="font-headline text-lg font-semibold mb-2 text-green-700 flex items-center">
                     <Apple className="mr-2 h-5 w-5" />
                    {translations.myPantryPage.availableIngredientsTitle}
                  </h4>
                   <p className="text-sm text-muted-foreground mb-3">{translations.myPantryPage.availableIngredientsDesc}</p>
                  <ul className="space-y-3">
                    {availableIngredientsForRecipe.map((item) => {
                      const stock = item.dbProduct?.stock ?? 0;
                      const currentVal = item.quantityToAddToCart;
                      const isAvailableInvalid = currentVal < 1 || !Number.isInteger(currentVal) || currentVal > stock;

                      return (
                      <li key={`available-${item.aiName.toLowerCase().replace(/\s+/g, '-')}`} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 bg-green-50 border border-green-200 rounded-md gap-2">
                        <span className="font-medium text-green-700 flex-grow">{item.dbProduct!.name}</span>
                         <div className="flex items-center gap-2 shrink-0">
                           <Input
                              type="number"
                              min="1"
                              max={stock > 0 ? stock : undefined}
                              value={item.quantityToAddToCart <= 0 ? '' : item.quantityToAddToCart}
                              onChange={(e) => handleIngredientQuantityChange('available', item.aiName, e.target.value)}
                              onBlur={() => handleIngredientQuantityBlur('available', item.aiName)}
                              className="w-20 h-9 text-center"
                              disabled={stock <= 0}
                              aria-label={`${translations.common.quantityFor.replace('{itemName}', item.dbProduct!.name)}`}
                            />
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="border-green-500 text-green-700 hover:bg-green-100" 
                              onClick={() => handleAddIngredientToCart(item)}
                              disabled={isAvailableInvalid || stock <= 0}
                            >
                              <ShoppingCart className="mr-2 h-4 w-4" /> {translations.buttons.addMoreToCart}
                            </Button>
                         </div>
                      </li>
                    )})}
                  </ul>
                </div>
              )}

              {!isFetchingMissingIngredients && (catalogMissingIngredients.length > 0 || uncataloguedAiSuggestions.length > 0) && (
                <div className="pt-4 border-t mt-6">
                  <h4 className="font-headline text-lg font-semibold mb-2 text-destructive flex items-center">
                    <ShoppingCart className="mr-2 h-5 w-5" />
                    {translations.myPantryPage.missingIngredientsTitleShort}
                  </h4>
                  {catalogMissingIngredients.length > 0 && (
                    <ul className="space-y-3 mb-4">
                      {catalogMissingIngredients.map((item) => {
                           const stock = item.dbProduct?.stock ?? 0;
                           const currentVal = item.quantityToAddToCart;
                           const isMissingInvalid = currentVal < 1 || !Number.isInteger(currentVal) || currentVal > stock;

                           return (
                            <li key={`missing-${item.aiName.toLowerCase().replace(/\s+/g, '-')}`} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 bg-destructive/10 border border-destructive/30 rounded-md gap-2">
                              <span className="font-medium text-destructive flex-grow">{item.dbProduct!.name} ({translations.myPantryPage.missingLabel})</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <Input
                                  type="number"
                                  min="1"
                                  max={stock > 0 ? stock : undefined}
                                  value={item.quantityToAddToCart <= 0 ? '' : item.quantityToAddToCart}
                                  onChange={(e) => handleIngredientQuantityChange('missing', item.aiName, e.target.value)}
                                  onBlur={() => handleIngredientQuantityBlur('missing', item.aiName)}
                                  className="w-20 h-9 text-center"
                                  disabled={stock <= 0}
                                  aria-label={`${translations.common.quantityFor.replace('{itemName}', item.dbProduct!.name)}`}
                                />
                                <Button 
                                  size="sm" 
                                  onClick={() => handleAddIngredientToCart(item)}
                                  disabled={isMissingInvalid || stock <= 0}
                                >
                                  <PlusCircle className="mr-2 h-4 w-4" /> {translations.buttons.addMissingToCart}
                                </Button>
                              </div>
                            </li>
                           )})}
                    </ul>
                  )}
                  {uncataloguedAiSuggestions.length > 0 && (
                     <p className="text-sm text-muted-foreground mt-2">
                        {translations.myPantryPage.unavailableIngredientsNote}: {uncataloguedAiSuggestions.join(', ')}.
                     </p>
                  )}
                </div>
              )}
              
              {!isFetchingMissingIngredients && catalogMissingIngredients.length === 0 && availableIngredientsForRecipe.length === 0 && (
                 <div className="text-center p-6 bg-yellow-50 border border-yellow-200 rounded-md text-yellow-700 mt-4">
                    <p className="font-semibold text-lg">{translations.myPantryPage.noMissingIngredientsInStock}</p>
                 </div>
              )}

              {!isFetchingMissingIngredients && catalogMissingIngredients.length === 0 && availableIngredientsForRecipe.length > 0 && uncataloguedAiSuggestions.length === 0 &&(
                 <div className="text-center p-6 bg-green-50 border border-green-200 rounded-md text-green-700 mt-4">
                    <CheckSquare className="h-12 w-12 mx-auto mb-2 text-green-500" />
                    <p className="font-semibold text-lg">{translations.myPantryPage.allSetTitle}</p>
                    <p>{translations.myPantryPage.allSetDesc}</p>
                </div>
              )}


              <div className="flex flex-col sm:flex-row gap-2 mt-6">
                 <Button onClick={() => setCurrentStep(PantryStep.Recipes)} variant="outline" className="flex-1" disabled={isGeneratingRecipeImage || isFetchingMissingIngredients}>{translations.buttons.backToRecipes}</Button>
                {(catalogMissingIngredients.length > 0 || availableIngredientsForRecipe.length > 0) && ( 
                  <Button asChild className="flex-1" disabled={isGeneratingRecipeImage || isFetchingMissingIngredients}>
                    <Link href="/cart"><ShoppingCart className="mr-2 h-5 w-5" /> {translations.buttons.goToCart}</Link>
                  </Button>
                )}
                 <Button onClick={resetPantryProcess} variant="outline" className="flex-1" disabled={isGeneratingRecipeImage || isFetchingMissingIngredients}>
                   <RefreshCw className="mr-2 h-4 w-4" /> {translations.buttons.startNewPantryCheck}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
       <header className="text-center">
        <h1 className="font-headline text-4xl font-bold text-primary">{translations.myPantryPage.title}</h1>
        <p className="text-lg text-muted-foreground">{translations.myPantryPage.tagline}</p>
      </header>
      {renderStepContent()}
    </div>
  );
}
