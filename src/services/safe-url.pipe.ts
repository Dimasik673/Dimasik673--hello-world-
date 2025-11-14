
import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { inject } from '@angular/core';

@Pipe({
  name: 'safeUrl',
  standalone: true,
})
export class SafeUrlPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(url: string | null): SafeResourceUrl | null {
    if (!url) {
        return null;
    }
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}
