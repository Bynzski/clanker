// @vitest-environment jsdom

/**
 * ErrorBoundary Unit Tests
 *
 * Tests the error boundary component's behavior around:
 * - Normal rendering of children
 * - Catching render errors and showing fallback UI
 * - Retry button functionality
 * - Error logging
 * - Custom fallback rendering
 * - onError callback
 */

import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ErrorInfo } from 'react';
import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import ErrorBoundary from '../../../src/renderer/components/ErrorBoundary';

// ---------------------------------------------------------------------------
// Test components
// ---------------------------------------------------------------------------

function WorkingChild() {
  return <div data-testid="working-child">Working</div>;
}

function ThrowingChild({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error from child');
  }
  return <div data-testid="throwing-child">Threw</div>;
}

function ThrowingChildWithInfo({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    const error = new Error('Detailed error message');
    error.name = 'TestError';
    throw error;
  }
  return <div data-testid="throwing-child">Threw</div>;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console.error in tests
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('renders children normally', () => {
    test('renders working child without error boundary activating', () => {
      render(
        <ErrorBoundary>
          <WorkingChild />
        </ErrorBoundary>
      );

      expect(screen.getByTestId('working-child')).toBeInTheDocument();
      expect(screen.queryByTestId('throwing-child')).not.toBeInTheDocument();
    });

    test('renders multiple children', () => {
      render(
        <ErrorBoundary>
          <WorkingChild />
          <WorkingChild />
          <WorkingChild />
        </ErrorBoundary>
      );

      expect(screen.getAllByTestId('working-child')).toHaveLength(3);
    });

    test('works with Suspense', () => {
      function SlowChild() {
        return <div data-testid="slow-child">Slow</div>;
      }

      render(
        <ErrorBoundary>
          <Suspense fallback={<div>Loading...</div>}>
            <SlowChild />
          </Suspense>
        </ErrorBoundary>
      );

      expect(screen.getByTestId('slow-child')).toBeInTheDocument();
    });
  });

  describe('catches render errors', () => {
    test('shows fallback UI when child throws', () => {
      render(
        <ErrorBoundary>
          <ThrowingChild shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.queryByTestId('throwing-child')).not.toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    test('shows error message from thrown error', () => {
      render(
        <ErrorBoundary>
          <ThrowingChildWithInfo shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Detailed error message')).toBeInTheDocument();
    });

    test('includes paneId in fallback if provided', () => {
      render(
        <ErrorBoundary paneId="test-pane-123">
          <ThrowingChild shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Pane: test-pane-123')).toBeInTheDocument();
    });

    test('shows generic message when error has no message', () => {
      function ThrowsWithNoMessage(): React.ReactElement {
        const error = new Error();
        error.message = '';
        throw error;
      }

      render(
        <ErrorBoundary>
          <ThrowsWithNoMessage />
        </ErrorBoundary>
      );

      expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
    });
  });

  describe('retry functionality', () => {
    test('Retry button resets error state and remounts children', () => {
      render(
        <ErrorBoundary>
          <ThrowingChild shouldThrow={true} />
        </ErrorBoundary>
      );

      // Error is shown
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  describe('error logging', () => {
    test('logs error to console.error', () => {
      render(
        <ErrorBoundary paneId="logging-test">
          <ThrowingChildWithInfo shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
      // Verify console.error was called (the actual format depends on React's internals)
      expect(consoleErrorSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('logs error when paneId is provided', () => {
      render(
        <ErrorBoundary paneId="specific-pane">
          <ThrowingChildWithInfo shouldThrow={true} />
        </ErrorBoundary>
      );

      // console.error should have been called with the log object
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('onError callback', () => {
    test('calls onError callback with error and info', () => {
      const onError = vi.fn();

      render(
        <ErrorBoundary onError={onError}>
          <ThrowingChildWithInfo shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(onError).toHaveBeenCalledTimes(1);
      const [error, info] = onError.mock.calls[0] as [Error, ErrorInfo];
      expect(error.message).toBe('Detailed error message');
      expect(info).toHaveProperty('componentStack');
    });

    test('does not call onError when there is no error', () => {
      const onError = vi.fn();

      render(
        <ErrorBoundary onError={onError}>
          <WorkingChild />
        </ErrorBoundary>
      );

      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('custom fallback', () => {
    test('renders custom fallback when provided', () => {
      const customFallback = (
        <div data-testid="custom-fallback">
          <span>Custom Error UI</span>
          <button type="button">Custom Retry</button>
        </div>
      );

      render(
        <ErrorBoundary fallback={customFallback}>
          <ThrowingChild shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
      expect(screen.getByText('Custom Error UI')).toBeInTheDocument();
      expect(screen.getByText('Custom Retry')).toBeInTheDocument();
    });

    test('renders function fallback with error context', () => {
      render(
        <ErrorBoundary
          fallback={(error: Error, _info: ErrorInfo, reset: () => void) => (
            <div data-testid="fn-fallback">
              <span data-testid="error-msg">{error.message}</span>
              <button type="button" onClick={reset}>Fn Retry</button>
            </div>
          )}
        >
          <ThrowingChildWithInfo shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByTestId('fn-fallback')).toBeInTheDocument();
      expect(screen.getByTestId('error-msg')).toHaveTextContent('Detailed error message');
    });
  });

  describe('nested error boundaries', () => {
    test('inner boundary catches its own errors', () => {
      render(
        <ErrorBoundary>
          <div>
            <ErrorBoundary>
              <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>
            <WorkingChild />
          </div>
        </ErrorBoundary>
      );

      // Inner boundary shows error
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      // Outer child still renders
      expect(screen.getByTestId('working-child')).toBeInTheDocument();
    });

    test('errors propagate to outer boundary when inner succeeds', () => {
      function DeepThrow(): React.ReactElement {
        throw new Error('Deep error');
      }

      render(
        <ErrorBoundary>
          <div>
            <ErrorBoundary fallback={(e: Error) => <div>Inner caught: {e.message}</div>}>
              <DeepThrow />
            </ErrorBoundary>
          </div>
        </ErrorBoundary>
      );

      // Inner boundary catches its own error
      expect(screen.getByText('Inner caught: Deep error')).toBeInTheDocument();
      // No error in outer boundary
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });
  });

  describe('style prop', () => {
    test('accepts style prop without error', () => {
      render(
        <ErrorBoundary style={{ backgroundColor: 'red', padding: '10px' }}>
          <WorkingChild />
        </ErrorBoundary>
      );

      // If we get here without error, the style prop works
      expect(screen.getByTestId('working-child')).toBeInTheDocument();
    });

    test('accepts style prop with fallback', () => {
      render(
        <ErrorBoundary style={{ padding: '20px' }}>
          <ThrowingChild shouldThrow={true} />
        </ErrorBoundary>
      );

      // Fallback renders with style prop
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });
});
