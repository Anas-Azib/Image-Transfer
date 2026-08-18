// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { ProgressBar } from '@/components/common/ProgressBar';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { StatGrid } from '@/components/common/StatGrid';
import { HomePage } from '@/app/routes/HomePage';

describe('Button', () => {
  it('fires its handler on click and on Enter', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Start</Button>);

    const button = screen.getByRole('button', { name: 'Start' });
    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('does not fire while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Start
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type="button" so it never submits a form implicitly', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

describe('Alert', () => {
  it('announces errors assertively', () => {
    render(
      <Alert tone="critical" title="Camera unavailable">
        Permission was declined.
      </Alert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Camera unavailable');
    expect(alert).toHaveTextContent('Permission was declined.');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('keeps non-error tones polite', () => {
    render(<Alert tone="info">Waiting for frames.</Alert>);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('ProgressBar', () => {
  it('exposes its value to assistive technology', () => {
    render(<ProgressBar label="Frames received" value={0.154} valueLabel="15.4%" />);
    const bar = screen.getByRole('progressbar', { name: 'Frames received' });
    expect(bar).toHaveAttribute('aria-valuenow', '15');
    expect(bar).toHaveAttribute('aria-valuetext', '15.4%');
  });

  it('omits a value while indeterminate', () => {
    render(<ProgressBar label="Searching" value={0} indeterminate />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('clamps out-of-range values', () => {
    render(<ProgressBar label="Overshoot" value={3} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('SegmentedControl', () => {
  it('renders real radios and reports the chosen value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SegmentedControl
        legend="Error correction"
        options={[
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ]}
        value="low"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Low' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'High' }));
    expect(onChange).toHaveBeenCalledWith('high');
  });

  it('blocks interaction when disabled', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        legend="Density"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        value="a"
        onChange={onChange}
        disabled
      />,
    );
    await userEvent.setup().click(screen.getByRole('radio', { name: 'B' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('StatGrid', () => {
  it('pairs each label with its value', () => {
    render(
      <StatGrid
        ariaLabel="Transmission statistics"
        stats={[
          { label: 'Rate', value: '9.9 fps' },
          { label: 'Passes', value: '3' },
        ]}
      />,
    );
    expect(screen.getByText('Rate')).toBeInTheDocument();
    expect(screen.getByText('9.9 fps')).toBeInTheDocument();
    expect(screen.getByLabelText('Transmission statistics')).toBeInTheDocument();
  });
});

describe('HomePage', () => {
  function renderHome() {
    return render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
  }

  it('offers exactly the two directions of a transfer', () => {
    renderHome();
    expect(screen.getByRole('link', { name: /Encode Image/i })).toHaveAttribute('href', '/encode');
    expect(screen.getByRole('link', { name: /Decode Image/i })).toHaveAttribute('href', '/decode');
  });

  it('leads with a single top-level heading', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Image Transfer');
  });

  it('states that the transfer needs no network', () => {
    renderHome();
    expect(screen.getByText(/No internet, no pairing, no cables/i)).toBeInTheDocument();
  });
});
