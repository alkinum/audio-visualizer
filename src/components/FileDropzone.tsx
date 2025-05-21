import React, { useState, useRef, useCallback } from 'react';
import { FileIcon, Upload } from 'lucide-react';

interface FileDropzoneProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
  isDarkMode: boolean;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({ onFileSelect, isLoading }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        validateAndSelectFile(file);
      }
    },
    [onFileSelect]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        validateAndSelectFile(file);
      }
    },
    [onFileSelect]
  );

  const validateAndSelectFile = useCallback(
    (file: File) => {
      if (file.type.startsWith('audio/')) {
        onFileSelect(file);
      } else {
        alert('Please select an audio file (MP3 or WAV).');
      }
    },
    [onFileSelect]
  );

  const openFileSelector = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  return (
    <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 cursor-pointer group ${isDragging ? 'border-primary bg-primary-light/10 dark:border-primary-light dark:bg-primary-dark/20' : 'border-gray-300 dark:border-gray-600 hover:border-primary dark:hover:border-primary-light hover:bg-gray-50 dark:hover:bg-gray-700/50'}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={openFileSelector}>
      <input type="file" ref={fileInputRef} className="hidden" accept="audio/mp3,audio/wav" onChange={handleFileSelect} />

      <div className="flex flex-col items-center justify-center">
        {isLoading ? (
          <div className="animate-pulse-slow flex flex-col items-center">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-light to-secondary-light dark:from-primary-dark dark:to-secondary-dark flex items-center justify-center mb-4 shadow-lg">
              <FileIcon className="w-10 h-10 text-white" />
            </div>
            <p className="text-lg font-medium text-primary dark:text-primary-light">Analyzing audio...</p>
          </div>
        ) : (
          <>
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary group-hover:from-primary-light group-hover:to-secondary-light dark:from-primary-dark dark:to-secondary-dark flex items-center justify-center mb-4 shadow-lg transition-all duration-300">
              <Upload className="w-10 h-10 text-white" />
            </div>
            <p className="text-lg font-medium text-gray-700 dark:text-gray-200 group-hover:text-primary dark:group-hover:text-primary-light transition-colors duration-300">Drag & drop your audio file here</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">or click to browse (MP3 or WAV)</p>
          </>
        )}
      </div>
    </div>
  );
};

export default FileDropzone;
