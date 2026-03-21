import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * React Error Boundary.
 * Catches JavaScript errors in child component trees and displays a graceful
 * fallback instead of crashing the entire app.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeCrashyComponent />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
    }

    handleReload = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500">
                        <RefreshCw size={26} />
                    </div>
                    <div className="space-y-1 max-w-sm">
                        <h3 className="text-lg font-bold text-dark-bg dark:text-light-bg">Something went wrong</h3>
                        <p className="text-sm text-dark-bg/50 dark:text-light-bg/50 leading-relaxed">
                            This note couldn't be loaded. Try reloading it.
                        </p>
                        {this.state.error && (
                            <pre className="mt-3 text-left text-xs text-dark-bg/40 dark:text-light-bg/40 bg-dark-bg/5 dark:bg-light-bg/5 rounded-lg p-3 overflow-auto max-h-32">
                                {this.state.error.message}
                            </pre>
                        )}
                    </div>
                    <button
                        onClick={this.handleReload}
                        className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 transition-colors shadow-md shadow-indigo-500/20"
                    >
                        Try again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
