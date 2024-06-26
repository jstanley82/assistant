import { Component } from '@angular/core';
import { AssistantIframe } from '@boldare/ai-embedded';
import { ChatService } from '../../shared/chat.service';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'ai-chat-home',
  standalone: true,
  templateUrl: './chat-cloud.component.html',
  styleUrl: './chat-cloud.component.scss',
})
export class ChatCloudComponent {
  constructor(private readonly chatService: ChatService) {
    if (environment.env === 'prod') {
      this.chatService.loadScript();
    } else {
      new AssistantIframe().init();
    }
  }
}
