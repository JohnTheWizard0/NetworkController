// Utility functions
class Utils {
    static debugLog(message) {
        console.log(message);
        const debugConsole = document.getElementById('debugConsole');
        if (debugConsole) {
            const timestamp = new Date().toLocaleTimeString();
            debugConsole.innerHTML += `[${timestamp}] ${message}\n`;
            debugConsole.scrollTop = debugConsole.scrollHeight;
        }
    }

    static toggleDebug() {
        const debugConsole = document.getElementById('debugConsole');
        debugConsole.style.display = debugConsole.style.display === 'none' ? 'block' : 'none';
    }

    static async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            Utils.showToast(`Kopiert: ${text}`);
        } catch (err) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            Utils.showToast(`Kopiert: ${text}`);
        }
    }

    static showToast(message, type = 'info', duration = 3000) {
        Utils.debugLog(`💬 Toast: ${message}`);
        
        // Remove existing toasts
        document.querySelectorAll('.toast').forEach(toast => {
            toast.remove();
        });
        
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        
        // Add type-specific styling
        switch (type) {
            case 'error':
                toast.style.background = '#e74c3c';
                break;
            case 'success':
                toast.style.background = '#27ae60';
                break;
            case 'warning':
                toast.style.background = '#f39c12';
                break;
            default:
                toast.style.background = '#2c3e50';
        }
        
        document.body.appendChild(toast);
        
        // Auto-remove after duration
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideOut 0.3s ease-out';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.remove();
                    }
                }, 300);
            }
        }, duration);
    }

    static showLoadingSpinner(element, show = true) {
        if (show) {
            element.innerHTML = '<span class="loading-spinner"></span>';
            element.disabled = true;
        } else {
            element.disabled = false;
        }
    }

    static formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    static formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    static isValidIP(ip) {
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip);
    }

    static isValidHostname(hostname) {
        const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
        return hostnameRegex.test(hostname);
    }

    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    static throttle(func, wait) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, wait);
            }
        }
    }

    static async fetchWithTimeout(url, options = {}, timeout = 5000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    static escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    static generateId() {
        return Math.random().toString(36).substr(2, 9);
    }

    static getTimestamp() {
        return new Date().toISOString();
    }

    static parseJSON(str) {
        try {
            return JSON.parse(str);
        } catch (e) {
            Utils.debugLog(`❌ JSON Parse Error: ${e.message}`);
            return null;
        }
    }

    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Global debug function
function toggleDebug() {
    Utils.toggleDebug();
}