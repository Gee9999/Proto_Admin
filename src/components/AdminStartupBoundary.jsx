import { Component } from 'react';
import { isChunkLoadError } from '../lib/lazyRetry';

/** Last-resort recovery for a stale or unavailable dashboard bundle. */
export default class AdminStartupBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[admin-startup]', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunkError = isChunkLoadError(error) || error?.code === 'startup_timeout';
    return (
      <div className="adm-login-page">
        <div className="adm-login-layout">
          <div className="adm-login-card adm-startup-recovery" role="alert">
            <div className="adm-login-logo" aria-hidden="true">P</div>
            <h1>Dashboard could not finish loading</h1>
            <p>
              {chunkError
                ? 'A website update or slow connection interrupted the dashboard files. Your work has not been changed.'
                : 'The Admin dashboard encountered an unexpected startup problem. Your work has not been changed.'}
            </p>
            <button type="button" className="adm-btn-red" onClick={() => window.location.reload()}>
              Reload dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
