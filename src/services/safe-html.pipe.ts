import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'safeHtml',
  standalone: true,
})
export class SafeHtmlPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(value: string | null): SafeHtml | null {
    if (value === null || value === undefined) {
      return null;
    }
    return this.sanitizer.bypassSecurityTrustHtml(value);
  }
}
