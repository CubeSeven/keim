import { FileText, Map, Code, PlaySquare, Music, Camera, Video, MonitorPlay } from 'lucide-react';

export const PlatformIcons = {
    YouTube: ({ className }: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
    ),
    Twitter: ({ className }: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.008 4.08H5.078z" />
        </svg>
    ),
    GitHub: ({ className }: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
    ),
    GoogleDocs: ({ className }: { className?: string }) => <FileText className={className} />,
    GoogleMaps: ({ className }: { className?: string }) => <Map className={className} />,
    Vimeo: ({ className }: { className?: string }) => <PlaySquare className={className} />,
    Twitch: ({ className }: { className?: string }) => <MonitorPlay className={className} />,
    SoundCloud: ({ className }: { className?: string }) => (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
            <path d="M11.666 16.54h-1.02V8.995l1.02.404v7.141zm-1.89-7.391l-1.018-.621v8.012h1.018V9.149zm-1.889-1.266l-1.02-.919v9.576h1.02V7.883zm-1.889-1.503l-1.02-1.036v11.115h1.02V6.38zm-1.89.544l-1.02-.91v10.571h1.02V6.924zm-1.888 1.106l-1.02-.731v9.465h1.02V8.03zm-1.89 1.502l-.65-.48v7.962h.65V9.532zM.35 11.232l-.35-.25v6.52h.35v-6.27zm11.967-3.953c-.347-.23-.746-.425-1.185-.55v9.81h11.218A3.65 3.65 0 0 0 24 12.89c0-1.99-1.637-3.606-3.65-3.606-.234 0-.46.024-.679.066a5.451 5.451 0 0 0-5.111-3.626c-1.002 0-1.94.27-2.731.75l.488.806z" />
        </svg>
    ),
    Spotify: ({ className }: { className?: string }) => <Music className={className} />,
    Instagram: ({ className }: { className?: string }) => <Camera className={className} />,
    TikTok: ({ className }: { className?: string }) => <Video className={className} />,
    CodePen: ({ className }: { className?: string }) => <Code className={className} />,
};