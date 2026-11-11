import { Component, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { DocumentRef } from '../../core/models';
import { errorMessage } from '../../shared/format';

type Kind = 'pdf' | 'image' | 'other';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : '';
}

@Component({
  selector: 'app-document-viewer',
  template: `
    <div class="card doc-card">
      <div class="card-head">
        <h2>Documents <span class="muted small">({{ documents().length }})</span></h2>
        @if (objectUrl(); as url) {
          <a class="btn btn-sm" [href]="url" [attr.download]="selectedDoc()?.filename || 'document'">Download</a>
        }
      </div>

      @if (!documents().length) {
        <div class="empty">No documents received with this submission yet.</div>
      } @else {
        <ul class="doc-list">
          @for (doc of documents(); track doc.file_id) {
            <li>
              <button type="button" class="doc-item" [class.active]="doc.file_id === selectedId()" (click)="selectedId.set(doc.file_id)">
                <span class="doc-name" [title]="doc.filename">{{ doc.filename }}</span>
                <span class="doc-meta">
                  @if (doc.is_primary) { <span class="chip tone-info">Primary</span> }
                  @if (doc.pages) { <span class="muted small">{{ doc.pages }} p.</span> }
                </span>
              </button>
            </li>
          }
        </ul>

        <div class="viewer">
          @if (loading()) {
            <div class="viewer-msg"><span class="spinner"></span> Loading document…</div>
          } @else if (error()) {
            <div class="viewer-msg"><div class="banner banner-bad">{{ error() }}</div></div>
          } @else if (kind() === 'pdf' && safeUrl()) {
            <iframe class="viewer-frame" [src]="safeUrl()" title="Document preview"></iframe>
          } @else if (kind() === 'image' && safeUrl()) {
            <div class="viewer-image"><img [src]="safeUrl()" [alt]="selectedDoc()?.filename || 'Document'" /></div>
          } @else if (objectUrl()) {
            <div class="viewer-msg">
              <p>This file type can't be previewed in the browser.</p>
              <a class="btn btn-primary" [href]="objectUrl()" [attr.download]="selectedDoc()?.filename || 'document'">Download {{ selectedDoc()?.filename }}</a>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .doc-card { display: flex; flex-direction: column; height: calc(100vh - var(--topbar-h) - 150px); min-height: 520px; }
    .doc-list { list-style: none; margin: 0; padding: 6px; border-bottom: 1px solid var(--border); max-height: 168px; overflow-y: auto; }
    .doc-item { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid transparent; border-radius: var(--radius-sm); background: none; font: inherit; text-align: left; cursor: pointer; color: var(--text); }
    .doc-item:hover { background: var(--surface-3); }
    .doc-item.active { background: var(--primary-soft); border-color: var(--info-border); }
    .doc-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .doc-meta { display: flex; align-items: center; gap: 6px; flex: none; }
    .viewer { flex: 1; min-height: 0; background: var(--surface-3); border-radius: 0 0 var(--radius) var(--radius); }
    .viewer-frame { width: 100%; height: 100%; border: 0; border-radius: 0 0 var(--radius) var(--radius); }
    .viewer-image { height: 100%; overflow: auto; padding: 12px; text-align: center; }
    .viewer-image img { max-width: 100%; box-shadow: var(--shadow); background: #fff; }
    .viewer-msg { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 16px; color: var(--muted); text-align: center; }
  `,
})
export class DocumentViewerComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly caseId = input.required<string>();
  readonly documents = input<DocumentRef[]>([]);

  readonly selectedId = signal<string | null>(null);
  readonly objectUrl = signal<string | null>(null);
  readonly kind = signal<Kind>('other');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly selectedDoc = computed(() => this.documents().find(d => d.file_id === this.selectedId()) ?? null);
  readonly safeUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.objectUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  private sub?: Subscription;

  constructor() {
    // Keep a valid selection: primary document first, else the first one.
    effect(() => {
      const docs = this.documents();
      const current = untracked(() => this.selectedId());
      if (!docs.length) {
        if (current !== null) this.selectedId.set(null);
        return;
      }
      if (!current || !docs.some(d => d.file_id === current)) {
        this.selectedId.set((docs.find(d => d.is_primary) ?? docs[0]).file_id);
      }
    });

    // Load the selected document whenever the selection changes.
    effect(() => {
      const caseId = this.caseId();
      const fileId = this.selectedId();
      untracked(() => this.fetch(caseId, fileId));
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.revoke();
  }

  private fetch(caseId: string, fileId: string | null): void {
    this.sub?.unsubscribe();
    this.revoke();
    this.error.set(null);
    if (!fileId) {
      this.loading.set(false);
      return;
    }
    const doc = this.documents().find(d => d.file_id === fileId);
    this.loading.set(true);
    this.sub = this.api.document(caseId, fileId).subscribe({
      next: blob => {
        const filename = doc?.filename ?? '';
        const ext = extensionOf(filename);
        const mime = (blob.type && blob.type !== 'application/octet-stream' ? blob.type : doc?.mime_type || '').toLowerCase();
        let kind: Kind = 'other';
        let typed = blob;
        if (mime.includes('pdf') || ext === 'pdf') {
          kind = 'pdf';
          if (blob.type !== 'application/pdf') typed = new Blob([blob], { type: 'application/pdf' });
        } else if (mime.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) {
          kind = 'image';
          if (!blob.type.startsWith('image/')) {
            typed = new Blob([blob], { type: ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}` });
          }
        }
        this.kind.set(kind);
        this.objectUrl.set(URL.createObjectURL(typed));
        this.loading.set(false);
      },
      error: async err => {
        let message = errorMessage(err, 'Could not load the document.');
        const body = err?.error;
        if (body instanceof Blob) {
          try {
            const parsed = JSON.parse(await body.text());
            if (typeof parsed?.detail === 'string') message = parsed.detail;
          } catch {
            /* not JSON */
          }
        }
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }

  private revoke(): void {
    const url = this.objectUrl();
    if (url) URL.revokeObjectURL(url);
    this.objectUrl.set(null);
  }
}
