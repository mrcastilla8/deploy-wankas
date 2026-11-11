'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, XCircle, CheckCircle, Camera, Video, VideoOff, PlusSquare, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Loader } from './ui/loader';
import { useLocale } from '@/context/locale-context';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


interface ImageUploaderProps {
  onImageUpload: (dataUris: string[]) => Promise<void>;
  isProcessing: boolean;
}

export function ImageUploader({ onImageUpload, isProcessing }: ImageUploaderProps) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();
  const { translations } = useLocale();

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);


  const MAX_FILES = 5;
  const MAX_FILE_SIZE_MB = 5;

  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(playError => {
          console.warn('Video play() attempt failed or was interrupted:', playError);
        });
      };
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [videoStream]);

  useEffect(() => {
    const currentStream = videoStream;
    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [videoStream]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles) {
      const newFiles: File[] = [...files];
      const newPreviews: string[] = [...previews];
      let currentError: string | null = null;

      for (let i = 0; i < selectedFiles.length; i++) {
        if (newFiles.length >= MAX_FILES) {
          currentError = translations.myPantryPage.imageUploader.maxFilesError.replace('{maxFiles}', MAX_FILES.toString());
          break;
        }
        const file = selectedFiles[i];
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          currentError = translations.myPantryPage.imageUploader.uploadErrorTooLarge.replace('{maxSize}', MAX_FILE_SIZE_MB.toString());
          continue; 
        }
        if (!file.type.startsWith('image/')) {
          currentError = translations.myPantryPage.imageUploader.uploadErrorInvalidType;
          continue;
        }
        newFiles.push(file);
        newPreviews.push(URL.createObjectURL(file));
      }
      
      setFiles(newFiles);
      setPreviews(newPreviews);
      if (currentError) {
        setError(currentError);
        toast({ title: translations.common.error, description: currentError, variant: 'destructive' });
      } else {
        setError(null);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const convertFilesToDataUris = async (filesToConvert: File[]): Promise<string[]> => {
    const dataUris = await Promise.all(
      filesToConvert.map(file => {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      })
    );
    return dataUris;
  };


  const handleSubmit = async () => {
    if (files.length === 0 && previews.filter(p => p.startsWith('data:image')).length === 0) {
       toast({ title: translations.common.noItems, description: translations.myPantryPage.imageUploader.noImageError, variant: 'destructive' });
       return;
    }
    
    const dataUrisFromFiles = await convertFilesToDataUris(files);
    const dataUrisFromCamera = previews.filter(p => p.startsWith('data:image') && !files.find(f => URL.createObjectURL(f) === p));
    
    const allDataUris = [...dataUrisFromCamera, ...dataUrisFromFiles];

    if (allDataUris.length === 0) {
      toast({ title: translations.common.noItems, description: translations.myPantryPage.imageUploader.noImageError, variant: 'destructive' });
      return;
    }

    try {
      await onImageUpload(allDataUris);
    } catch (err) {
      toast({ title: translations.common.error, description: translations.myPantryPage.imageUploader.processingError, variant: 'destructive' });
    }
  };

  const handleRemoveImage = (indexToRemove: number) => {
    const removedPreview = previews[indexToRemove];
    const newPreviews = previews.filter((_, index) => index !== indexToRemove);
    
    let updatedFiles = [...files];
    const correspondingFileIndex = files.findIndex(f => URL.createObjectURL(f) === removedPreview);
    if (correspondingFileIndex !== -1) {
        updatedFiles = files.filter((_, idx) => idx !== correspondingFileIndex);
    }
    
    if (removedPreview.startsWith('blob:')) {
        URL.revokeObjectURL(removedPreview);
    }

    setPreviews(newPreviews);
    setFiles(updatedFiles);

    if (newPreviews.length === 0) setError(null);
  };
  
  const handleClearAllImages = () => {
    previews.forEach(preview => {
      if (preview.startsWith('blob:')) {
        URL.revokeObjectURL(preview);
      }
    });
    setPreviews([]);
    setFiles([]);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };


  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      if (fileInputRef.current) {
        const dataTransfer = new DataTransfer();
        Array.from(event.dataTransfer.files).forEach(file => dataTransfer.items.add(file));
        fileInputRef.current.files = dataTransfer.files;
        
        const changeEvent = new Event('change', { bubbles: true }) as unknown as React.ChangeEvent<HTMLInputElement>;
        Object.defineProperty(changeEvent, 'target', { writable: false, value: { files: dataTransfer.files } });
        handleFileChange(changeEvent);
      }
    }
  }, [files.length, previews.length, MAX_FILES, translations]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const startCamera = async () => {
    if (previews.length >= MAX_FILES) {
        const maxFilesError = translations.myPantryPage.imageUploader.maxFilesError.replace('{maxFiles}', MAX_FILES.toString());
        setError(maxFilesError);
        toast({ title: translations.common.error, description: maxFilesError, variant: 'destructive' });
        return;
    }
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        setVideoStream(null);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setVideoStream(stream);
      setIsCameraActive(true);
      setHasCameraPermission(true);
      setError(null);
    } catch (err) {
      console.error("Error accessing camera:", err);
      setHasCameraPermission(false);
      setError(translations.myPantryPage.imageUploader.cameraAccessDenied);
      toast({
        variant: 'destructive',
        title: translations.myPantryPage.imageUploader.cameraErrorTitle,
        description: translations.myPantryPage.imageUploader.cameraAccessDenied,
      });
      setIsCameraActive(false);
      setVideoStream(null);
    }
  };

  const stopCamera = () => {
    setIsCameraActive(false);
    setVideoStream(null);
  };

  const toggleCamera = async () => {
    if (isCameraActive) {
      stopCamera();
    } else {
      await startCamera();
    }
  };

  const handleCapturePhoto = () => {
    if (videoRef.current && canvasRef.current && videoStream) {
      if (previews.length >= MAX_FILES) {
          const maxFilesError = translations.myPantryPage.imageUploader.maxFilesError.replace('{maxFiles}', MAX_FILES.toString());
          setError(maxFilesError);
          toast({ title: translations.common.error, description: maxFilesError, variant: 'destructive' });
          return;
      }
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUri = canvas.toDataURL('image/jpeg'); 
      
      fetch(dataUri)
        .then(res => res.blob())
        .then(blob => {
            const capturedFile = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
            setFiles(prev => [...prev, capturedFile]);
            setPreviews(prev => [...prev, URL.createObjectURL(capturedFile)]); 
        });
      
      setError(null);
    }
  };

  return (
    <div className="w-full space-y-4 p-6 border rounded-lg shadow-md bg-card">
      {!isCameraActive && (
        <div
          className={cn(
            "relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer transition-colors",
            error && previews.length === 0 ? "border-destructive" : "border-border hover:border-primary",
            previews.length > 0 ? "border-primary" : ""
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => !isProcessing && fileInputRef.current?.click()}
        >
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
            id="image-upload-input"
            aria-label={translations.myPantryPage.imageUploader.uploadImageLabel}
            disabled={previews.length >= MAX_FILES || isProcessing}
          />
          {isProcessing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10 rounded-lg">
              <Loader text={translations.myPantryPage.imageUploader.identifyingText} size={40}/>
            </div>
          )}
          {!isProcessing && (
            <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center">
              <UploadCloud className="w-10 h-10 mb-3 text-muted-foreground" />
              <p className="mb-1 text-sm text-muted-foreground">
                <span className="font-semibold">{translations.myPantryPage.imageUploader.clickToUpload}</span> {translations.common.or} {translations.myPantryPage.imageUploader.dragAndDrop}
              </p>
              <p className="text-xs text-muted-foreground">{translations.myPantryPage.imageUploader.imageFormatHint.replace('{maxSize}', MAX_FILE_SIZE_MB.toString())}</p>
              <p className="text-xs text-muted-foreground">{translations.myPantryPage.imageUploader.maxFilesHint.replace('{maxFiles}', MAX_FILES.toString())}</p>
            </div>
          )}
        </div>
      )}
      
      <Button
        onClick={toggleCamera}
        variant="outline"
        className="w-full"
        disabled={isProcessing || (previews.length >= MAX_FILES && !isCameraActive)}
      >
        {isCameraActive ? <VideoOff className="mr-2" /> : <Camera className="mr-2" />}
        {isCameraActive ? translations.myPantryPage.imageUploader.closeCamera : translations.myPantryPage.imageUploader.openCamera}
      </Button>

      {isCameraActive && (
        <div className="space-y-2">
          <video ref={videoRef} className="w-full aspect-video rounded-md bg-muted" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />
          {hasCameraPermission === false && !error?.includes(translations.myPantryPage.imageUploader.cameraAccessDenied) && (
             <Alert variant="destructive">
              <AlertTitle>{translations.myPantryPage.imageUploader.cameraErrorTitle}</AlertTitle>
              <AlertDescription>{translations.myPantryPage.imageUploader.cameraAccessDenied}</AlertDescription>
            </Alert>
          )}
          {hasCameraPermission && videoStream && (
            <Button onClick={handleCapturePhoto} className="w-full" disabled={previews.length >= MAX_FILES}>
              <PlusSquare className="mr-2" /> {translations.myPantryPage.imageUploader.capturePhoto}
            </Button>
          )}
        </div>
      )}
      
      {error && <p className="text-sm text-destructive text-center">{error}</p>}

      {previews.length > 0 && (
        <div className="space-y-3 pt-4">
          <h4 className="font-medium">{translations.myPantryPage.imageUploader.imagePreviewTitle} ({previews.length}/{MAX_FILES})</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {previews.map((src, index) => (
              <div key={index} className="relative group aspect-square">
                <Image src={src} alt={`${translations.myPantryPage.imageUploader.imagePreviewAlt} ${index + 1}`} fill style={{ objectFit: 'cover' }} className="rounded-md shadow-md" unoptimized={src.startsWith('blob:')} />
                {!isProcessing && (
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => handleRemoveImage(index)}
                    className="absolute top-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    aria-label={`${translations.myPantryPage.imageUploader.removeImageLabel} ${index + 1}`}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button onClick={handleClearAllImages} variant="outline" className="flex-1" disabled={isProcessing}>
              <Trash2 className="mr-2 h-4 w-4" /> {translations.myPantryPage.imageUploader.clearAll}
            </Button>
            <Button onClick={handleSubmit} className="flex-1" disabled={isProcessing || previews.length === 0}>
              {isProcessing ? <Loader size={20}/> : <CheckCircle className="mr-2 h-5 w-5" />}
              {translations.myPantryPage.imageUploader.identifyButton}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
