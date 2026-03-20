import { useNodeViewContext } from '@prosemirror-adapter/react';
import { PlatformIcons } from './AppIcon';
import { Tweet } from 'react-tweet';
import { useState, useRef, useEffect } from 'react';

export const AppLinkView = () => {
    const { node } = useNodeViewContext();
    const url = node.attrs.url;
    const platform = node.attrs.platform;
    const title = node.attrs.title;
    
    const wrapperRef = useRef<HTMLSpanElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    
    // Crucial for performance: only load iframes when the user hovers over the link.
    const [isHovered, setIsHovered] = useState(false);
    const [popupPosition, setPopupPosition] = useState<'top' | 'bottom'>('top');
    const hoverTimeout = useRef<number | null>(null);

    const handleMouseEnter = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        
        // Calculate available space to decide if popup should open upwards or downwards
        if (wrapperRef.current) {
            const rect = wrapperRef.current.getBoundingClientRect();
            // Assuming a max popup height around 500px, if we have less than that above, open downward
            if (rect.top < 500) {
                setPopupPosition('bottom');
            } else {
                setPopupPosition('top');
            }
        }
        
        setIsHovered(true);
    };

    const handleMouseLeave = () => {
        // Add a small delay before unmounting so the popup doesn't flash if the mouse moves slightly off
        hoverTimeout.current = window.setTimeout(() => {
            setIsHovered(false);
        }, 300);
    };

    useEffect(() => {
        return () => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        };
    }, []);

    const Icon = PlatformIcons[platform as keyof typeof PlatformIcons] || null;

    let tweetId = '';
    if (platform === 'Twitter') {
        const match = url.match(/\/status\/(\d+)/);
        if (match) tweetId = match[1];
    }

    return (
        <span 
            ref={wrapperRef}
            className="app-link-wrapper inline-block mx-1 align-bottom group relative"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <a 
                href={url} 
                target="_blank" 
                rel="noopener noreferrer"
                contentEditable={false}
                className={`
                    inline-flex items-center gap-1.5 !px-2 !py-0.5 rounded-md text-[13px] font-medium transition-all no-underline
                    border shadow-sm
                    ${platform === 'YouTube' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 hover:bg-red-500/20' : ''}
                    ${platform === 'Twitter' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20 hover:bg-sky-500/20' : ''}
                    ${platform === 'GitHub' ? 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20 hover:bg-slate-500/20' : ''}
                    ${platform === 'GoogleDocs' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 hover:bg-blue-500/20' : ''}
                    ${platform === 'GoogleMaps' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20 hover:bg-green-500/20' : ''}
                    ${platform === 'Vimeo' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20 hover:bg-sky-500/20' : ''}
                    ${platform === 'Twitch' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 hover:bg-purple-500/20' : ''}
                    ${platform === 'SoundCloud' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20 hover:bg-orange-500/20' : ''}
                    ${platform === 'Spotify' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20 hover:bg-green-500/20' : ''}
                    ${platform === 'Instagram' ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20 hover:bg-pink-500/20' : ''}
                    ${platform === 'TikTok' ? 'bg-gray-800/10 text-gray-800 dark:text-gray-200 border-gray-800/20 hover:bg-gray-800/20 dark:bg-gray-200/10 dark:hover:bg-gray-200/20' : ''}
                    ${platform === 'CodePen' ? 'bg-zinc-800/10 text-zinc-800 dark:text-zinc-200 border-zinc-800/20 hover:bg-zinc-800/20 dark:bg-zinc-200/10 dark:hover:bg-zinc-200/20' : ''}
                    ${platform === 'Unknown' ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700' : ''}
                `}
                onClick={(e) => {
                    e.stopPropagation();
                }}
            >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                <span className="truncate max-w-[200px]">{title}</span>
            </a>

            {/* Render Popup Only When Hovered to Save Memory */}
            {isHovered && (platform === 'YouTube' || platform === 'Twitter') && (
                <div 
                    ref={popupRef}
                    className={`absolute left-1/2 -translate-x-1/2 z-50 animate-in fade-in zoom-in-95 duration-200 ${
                        popupPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
                    }`}
                >
                    <div className={`bg-light-bg dark:bg-dark-bg rounded-xl shadow-2xl border border-light-ui dark:border-dark-ui overflow-hidden 
                        ${platform === 'YouTube' ? 'w-[260px] !p-1' : ''}
                        ${platform === 'Twitter' ? 'w-[260px] !p-1' : ''}
                    `}>
                        {platform === 'YouTube' && (
                            <a 
                                href={url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="block relative !pt-[56.25%] rounded-lg overflow-hidden bg-dark-bg/10 dark:bg-light-bg/10 group/thumb"
                            >
                                <img 
                                    src={`https://img.youtube.com/vi/${url.match(/[?&]v=([^&]+)/)?.[1] || url.match(/youtu\.be\/([^?]+)/)?.[1]}/mqdefault.jpg`}
                                    alt="YouTube Thumbnail"
                                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover/thumb:scale-105"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${url.match(/[?&]v=([^&]+)/)?.[1] || url.match(/youtu\.be\/([^?]+)/)?.[1]}/hqdefault.jpg`;
                                    }}
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/thumb:bg-black/10 transition-colors">
                                    <div className="w-10 h-10 bg-red-600/90 backdrop-blur-sm rounded-full flex items-center justify-center text-white shadow-lg drop-shadow-md transition-transform group-hover/thumb:scale-110 group-hover/thumb:bg-red-600">
                                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 ml-1">
                                            <path d="M8 5v14l11-7z" />
                                        </svg>
                                    </div>
                                </div>
                            </a>
                        )}
                        
                        {platform === 'Twitter' && tweetId && (
                            <div className="max-h-[350px] overflow-y-auto no-scrollbar bg-white dark:bg-black rounded-lg [&_.react-tweet-theme]:!my-0 [&_.react-tweet-theme]:!max-w-none text-[0.85em] [&_.react-tweet-theme]:!p-3">
                                <Tweet id={tweetId} />
                            </div>
                        )}
                    </div>
                    {/* Tooltip Arrow */}
                    <div className={`absolute left-1/2 -translate-x-1/2 border-4 border-transparent ${
                        popupPosition === 'top' 
                            ? 'top-full -mt-1 border-t-light-ui dark:border-t-dark-ui' 
                            : 'bottom-full -mb-1 border-b-light-ui dark:border-b-dark-ui'
                    }`} />
                </div>
            )}
        </span>
    );
};