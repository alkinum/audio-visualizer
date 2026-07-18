<script lang="ts">
  import { FileAudio2, Upload } from '@lucide/svelte';

  interface Props {
    onSelect: (file: File) => void;
    busy?: boolean;
    compact?: boolean;
    label?: string;
    multiple?: boolean;
    onSelectMultiple?: (files: File[]) => void;
  }

  let {
    onSelect,
    busy = false,
    compact = false,
    label,
    multiple = false,
    onSelectMultiple,
  }: Props = $props();
  let input: HTMLInputElement;
  let dragging = $state(false);
  const primaryLabel = $derived(
    label ?? (compact ? 'Replace file' : busy ? 'Decoding audio' : multiple ? 'Open one or two audio files' : 'Open an audio file'),
  );
  const secondaryLabel = $derived(
    multiple ? 'Drop up to two files here or choose from this device' : 'Drop a file here or choose from this device',
  );

  function selectFiles(files: FileList | null): void {
    const selected = Array.from(files ?? []).slice(0, multiple ? 2 : 1);
    if (selected.length === 0) return;
    if (multiple && onSelectMultiple) onSelectMultiple(selected);
    else onSelect(selected[0]);
    input.value = '';
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    dragging = false;
    if (!busy || compact) selectFiles(event.dataTransfer?.files ?? null);
  }

  function openPicker(): void {
    if (!busy || compact) input.click();
  }
</script>

<input
  bind:this={input}
  class="visually-hidden"
  type="file"
  {multiple}
  accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus"
  onchange={(event) => selectFiles(event.currentTarget.files)}
/>

<button
  class:compact
  class:dragging
  class="file-drop"
  type="button"
  disabled={busy && !compact}
  onclick={openPicker}
  ondragenter={(event) => {
    event.preventDefault();
    dragging = true;
  }}
  ondragover={(event) => {
    event.preventDefault();
    dragging = true;
  }}
  ondragleave={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dragging = false;
  }}
  ondrop={handleDrop}
>
  <span class="file-drop-icon" aria-hidden="true">
    {#if busy}
      <FileAudio2 size={compact ? 17 : 25} strokeWidth={1.7} />
    {:else}
      <Upload size={compact ? 17 : 25} strokeWidth={1.7} />
    {/if}
  </span>
  <span class="file-drop-copy">
    <strong>{primaryLabel}</strong>
    {#if !compact}
      <small>{busy ? 'Reading waveform data locally' : secondaryLabel}</small>
    {/if}
  </span>
  {#if busy}
    <span class="file-drop-progress" aria-hidden="true"></span>
  {/if}
</button>
