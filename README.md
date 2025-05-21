# Audio Visualizer

A modern web-based audio visualization tool that transforms audio files into beautiful waveform and spectrum visualizations.

## Features

- **Waveform Visualization**: See a detailed waveform representation of your audio
- **Spectrum Analysis**: Real-time frequency spectrum visualization
- **User-friendly Controls**: Simple audio playback with keyboard shortcuts
- **File Dropzone**: Easy drag-and-drop interface for uploading audio files
- **Responsive Design**: Works on desktop and mobile devices
- **Dark/Light Mode**: Toggle between dark and light themes

## Tech Stack

- React 18
- TypeScript
- Web Audio API
- Tailwind CSS
- Vite

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/alkinum/audio-visualizer.git
   cd audio-visualizer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:5173`

## Building for Production

To build the application for production:

```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory.

## Deployment

This project is configured for deployment to Cloudflare Pages:

1. Push your code to GitHub
2. Connect your repository to Cloudflare Pages
3. Configure the build settings:
   - Build command: `npm run build`
   - Build output directory: `dist`

A wrangler.toml file is included for Cloudflare Pages deployment.

## License

MIT
