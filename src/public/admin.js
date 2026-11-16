/* global document, fetch, AbortSignal, navigator */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const keyDialog = $('key-dialog');
  const createdDialog = $('created-dialog');
  const deleteDialog = $('delete-dialog');
  let keys = [];
  let loaded = false;
  let sessionExpired = false;
  let editingKey = null;
  let deletingKey = null;
  let saving = false;
  let deleting = false;

  function notice(message, error = false) {
    $('notice').textContent = message;
    $('notice').classList.toggle('error', error);
    $('notice').hidden = !message;
  }

  function showError(id, message) {
    $(id).textContent = message;
    $(id).hidden = !message;
  }

  function lockSession() {
    sessionExpired = true;
    keys = [];
    for (const dialog of [keyDialog, createdDialog, deleteDialog]) dialog.close();
    $('keys-body').replaceChildren();
    for (const id of ['total-count', 'active-count', 'expired-count']) $(id).textContent = '—';
    $('key-count').textContent = '0';
    $('results-count').textContent = 'Authentication required';
    $('empty-state').hidden = false;
    $('empty-create-key').hidden = true;
    $('empty-title').textContent = 'Your admin session is no longer valid.';
    $('empty-description').textContent =
      'Log in through the app with the admin Steam account, then reload this page.';
    document.querySelector('.page-footer').lastElementChild.textContent = 'Steam session expired';
    for (const id of ['create-key', 'refresh-keys', 'search-keys', 'status-filter'])
      $(id).disabled = true;
    notice('Admin access is required. Log in again in this browser, then reload /admin.', true);
  }

  async function request(path = '', options = {}) {
    let response;
    try {
      response = await fetch(`/admin/keys${path}`, {
        ...options,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch (error) {
      throw new Error(
        error.name === 'TimeoutError'
          ? 'The request timed out. Refresh the list before retrying to check whether your change was saved.'
          : 'Could not reach the API. Check your connection and refresh the list before retrying.',
      );
    }

    if (response.status === 401 || response.status === 403) {
      lockSession();
      throw new Error('Your admin session has expired. Log in through the app again.');
    }
    if (response.status === 429) {
      throw new Error('Too many requests. Wait a moment, then try again.');
    }
    if (response.status === 204) return null;

    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        data?.error || `The request failed (${response.status}). Try refreshing the list.`,
      );
    if (!data) throw new Error('The API returned an unexpected response. Refresh and try again.');
    return data;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function dateCell(timestamp, expiry = false) {
    const cell = element('td');
    const date = new Date(timestamp);
    const time = element(
      'time',
      expiry && timestamp <= Date.now() ? 'expired-date' : '',
      date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    );
    time.dateTime = date.toISOString();
    time.title = date.toLocaleString();
    cell.append(time);
    if (expiry) {
      const remaining = timestamp - Date.now();
      const detail =
        remaining <= 0
          ? 'Expired'
          : remaining < 86400000
            ? 'Less than a day left'
            : `${Math.ceil(remaining / 86400000)} days left`;
      cell.append(element('span', 'date-detail', detail));
    }
    return cell;
  }

  function formatUsage(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    if (value < 60) return `${value}s`;
    if (value < 3600) return `${Math.floor(value / 60)}m`;
    if (value < 86400) return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
    return `${Math.floor(value / 86400)}d ${Math.floor((value % 86400) / 3600)}h`;
  }

  function renderKeys() {
    const now = Date.now();
    const active = keys.filter((key) => key.exp > now).length;
    $('total-count').textContent = keys.length;
    $('active-count').textContent = active;
    $('expired-count').textContent = keys.length - active;
    $('key-count').textContent = keys.length;

    const search = $('search-keys').value.trim().toLocaleLowerCase();
    const status = $('status-filter').value;
    const filtered = keys
      .filter((key) => {
        const matchesSearch = `${key.label} ${key.id}`.toLocaleLowerCase().includes(search);
        return (
          matchesSearch && (status === 'all' || (key.exp > now ? 'active' : 'expired') === status)
        );
      })
      .sort((a, b) => b.iat - a.iat);

    const rows = filtered.map((key) => {
      const row = element('tr');
      const identity = element('td');
      const label = element('span', 'key-label', key.label);
      label.title = `${key.label}\nID: ${key.id}`;
      identity.append(label, element('code', 'key-preview', key.key));
      const state = element('td');
      const isActive = key.exp > now;
      const pill = element('span', `status-pill${isActive ? '' : ' expired'}`);
      const dot = element('span', `dot ${isActive ? 'active-dot' : 'expired-dot'}`);
      dot.setAttribute('aria-hidden', 'true');
      pill.append(dot, document.createTextNode(isActive ? 'Active' : 'Expired'));
      state.append(pill);
      const usage = element('td', '', formatUsage(key.usage));
      usage.title = `${key.usage.toLocaleString()} seconds of server connection time, recorded on disconnect`;
      const actions = element('td');
      const controls = element('div', 'row-actions');
      const edit = element('button', 'edit-button', 'Edit');
      edit.type = 'button';
      edit.setAttribute('aria-label', `Edit ${key.label}`);
      edit.addEventListener('click', () => openKeyForm(key));
      const remove = element('button', 'icon-button delete-button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Delete ${key.label}`);
      remove.title = 'Delete key';
      remove.innerHTML =
        '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>';
      remove.addEventListener('click', () => {
        deletingKey = key;
        $('delete-label').textContent = key.label;
        showError('delete-error', '');
        deleteDialog.showModal();
      });
      controls.append(edit, remove);
      actions.append(controls);
      row.append(identity, state, dateCell(key.iat), dateCell(key.exp, true), usage, actions);
      return row;
    });

    $('keys-body').replaceChildren(...rows);
    $('empty-state').hidden = filtered.length > 0;
    $('empty-title').textContent = keys.length
      ? 'No matching keys.'
      : 'Your first server starts here.';
    $('empty-description').textContent = keys.length
      ? 'Try a different search or status filter.'
      : 'Create an API key to connect a CS2 server to Proximity.';
    $('empty-create-key').hidden = keys.length > 0;
    $('results-count').textContent =
      `Showing ${filtered.length} of ${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`;
  }

  async function loadKeys() {
    $('refresh-keys').disabled = true;
    $('refresh-keys').textContent = 'Refreshing…';
    $('table-region').setAttribute('aria-busy', 'true');
    try {
      const data = await request();
      if (!Array.isArray(data)) throw new Error('The API returned an unexpected key list.');
      keys = data;
      loaded = true;
      notice('');
      renderKeys();
    } catch (error) {
      if (!sessionExpired) {
        notice(error.message, true);
        if (!loaded) {
          $('empty-title').textContent = 'Could not load your keys.';
          $('empty-description').textContent = 'Use Refresh to try again.';
          $('results-count').textContent = 'Keys unavailable';
        }
      }
    } finally {
      $('table-region').setAttribute('aria-busy', 'false');
      $('refresh-keys').textContent = '↻ Refresh';
      $('refresh-keys').disabled = sessionExpired;
      $('create-key').disabled = !loaded || sessionExpired;
    }
  }

  function syncExpiryField() {
    const custom = $('key-expiry').value === 'custom';
    $('custom-expiry-field').hidden = !custom;
    $('custom-expiry').disabled = !custom;
    $('custom-expiry').required = custom;
  }

  function openKeyForm(key = null) {
    editingKey = key;
    $('key-form').reset();
    $('key-dialog-title').textContent = key ? 'Edit API key' : 'Create API key';
    $('key-dialog-description').textContent = key
      ? 'Update this server’s label or renew its access. The key itself stays the same.'
      : 'Give this key a name so you can identify its server.';
    $('key-label').value = key?.label || '';
    $('keep-expiry').hidden = !key;
    $('keep-expiry').disabled = !key;
    $('key-expiry').value = key ? '' : '30';
    $('expiry-help').textContent = key
      ? 'A new duration resets expiration from the time you save, even for an expired key.'
      : 'Expiration starts when the key is created.';
    $('save-key').textContent = key ? 'Save changes' : 'Create key';
    showError('form-error', '');
    syncExpiryField();
    keyDialog.showModal();
    $('key-label').focus();
  }

  function updateKey(key) {
    // Creation responses contain the secret; retain only its masked preview in the list.
    const preview = { ...key, key: `**************${key.key.slice(-3)}` };
    const index = keys.findIndex((item) => item.id === preview.id);
    if (index === -1) keys.push(preview);
    else keys[index] = preview;
    renderKeys();
  }

  function setFormBusy(busy) {
    saving = busy;
    for (const field of $('key-form').elements) field.disabled = busy;
    if (!busy) {
      $('keep-expiry').disabled = !editingKey;
      syncExpiryField();
    }
  }

  $('key-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    const label = $('key-label').value.trim();
    if (!label) return showError('form-error', 'Enter a label for this server.');
    const payload = {};
    if (!editingKey || label !== editingKey.label) payload.label = label;
    const duration = $('key-expiry').value;
    if (duration) {
      const days = Number(duration === 'custom' ? $('custom-expiry').value : duration);
      if (!Number.isInteger(days) || days < 1 || days > 36500) {
        return showError('form-error', 'Enter a whole number of days between 1 and 36,500.');
      }
      payload.expiresIn = days * 86400;
    }
    if (!Object.keys(payload).length) {
      keyDialog.close();
      return notice('No changes to save.');
    }

    showError('form-error', '');
    setFormBusy(true);
    $('save-key').textContent = 'Saving…';
    const wasEditing = Boolean(editingKey);
    try {
      const key = await request(editingKey ? `/${encodeURIComponent(editingKey.id)}` : '', {
        method: editingKey ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      updateKey(key);
      keyDialog.close();
      if (wasEditing) {
        notice('API key updated.');
      } else {
        $('created-key').value = key.key;
        $('copy-status').textContent = 'Add this key to your CS2 plugin configuration.';
        $('copy-key').textContent = 'Copy key';
        createdDialog.showModal();
      }
    } catch (error) {
      if (!sessionExpired) showError('form-error', error.message);
    } finally {
      setFormBusy(false);
      $('save-key').textContent = wasEditing ? 'Save changes' : 'Create key';
    }
  });

  $('confirm-delete').addEventListener('click', async () => {
    if (deleting || !deletingKey) return;
    deleting = true;
    for (const button of deleteDialog.querySelectorAll('button')) button.disabled = true;
    $('confirm-delete').textContent = 'Deleting…';
    try {
      await request(`/${encodeURIComponent(deletingKey.id)}`, { method: 'DELETE' });
      keys = keys.filter((key) => key.id !== deletingKey.id);
      renderKeys();
      deleteDialog.close();
      notice('API key deleted.');
    } catch (error) {
      if (!sessionExpired) showError('delete-error', error.message);
    } finally {
      deleting = false;
      for (const button of deleteDialog.querySelectorAll('button')) button.disabled = false;
      $('confirm-delete').textContent = 'Delete key';
    }
  });

  $('copy-key').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('created-key').value);
      $('copy-key').textContent = 'Copied!';
      $('copy-status').textContent = 'Copied to clipboard. Store this key securely.';
    } catch {
      $('created-key').focus();
      $('created-key').select();
      $('copy-status').textContent =
        'Clipboard unavailable. The key is selected; copy it manually.';
    }
  });

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => $(button.dataset.close).close());
  }
  keyDialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault();
  });
  deleteDialog.addEventListener('cancel', (event) => {
    if (deleting) event.preventDefault();
  });
  createdDialog.addEventListener('close', () => {
    $('created-key').value = '';
  });
  $('create-key').addEventListener('click', () => openKeyForm());
  $('empty-create-key').addEventListener('click', () => openKeyForm());
  $('key-expiry').addEventListener('change', syncExpiryField);
  $('search-keys').addEventListener('input', () => {
    if (loaded) renderKeys();
  });
  $('status-filter').addEventListener('change', () => {
    if (loaded) renderKeys();
  });
  $('refresh-keys').addEventListener('click', loadKeys);
  loadKeys();
})();
