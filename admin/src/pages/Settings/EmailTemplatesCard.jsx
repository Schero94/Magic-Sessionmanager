import { Fragment, useState } from 'react';
import { Badge, Box, Button, Flex, Tabs, Tag, Textarea, TextInput, Typography } from '@strapi/design-system';
import { useNotification } from '@strapi/strapi/admin';
import { Duplicate } from '@strapi/icons';
import styled from 'styled-components';
import { ConfirmAction } from '../../components/ui';
import FormField from '../../components/FormField';
import {
  TEMPLATE_KEYS,
  TEMPLATE_VARIABLE_DEFINITIONS,
  TEMPLATE_VARIABLES,
  findTemplateVariables,
  getDefaultTemplates,
  renderTemplatePreview,
  updateEmailTemplate,
} from '../../utils/emailTemplateDraft.mjs';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Monospace template editor in DS colours. DS Textarea provides the field
 * id, aria-describedby, error state and the native focus ring (SET-07).
 */
const CodeTextarea = styled(Textarea)`
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: ${({ theme }) => theme.fontSizes[2]};
  white-space: pre;
  overflow-wrap: normal;
`;

/** Equal-width template tabs, also on phones (SET-13 browser). */
const TemplateTabsList = styled(Tabs.List)`
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;

  & > button {
    min-width: 0;
    overflow-wrap: anywhere;
  }
`;

/**
 * Variables as "tag | meaning" pairs. Tags share one column per pair, so
 * every description starts on the same edge: two pairs per row when the
 * editor is at least 720 px wide (container query), else one pair per row.
 */
const VariableGridFrame = styled.div`
  container-type: inline-size;
  min-width: 0;
`;

const VariableGrid = styled.div`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: ${({ theme }) => theme.spaces[3]};
  min-width: 0;

  @container (min-width: 720px) {
    grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr);
    column-gap: ${({ theme }) => theme.spaces[4]};
  }
`;

const PreviewFrame = styled.iframe`
  display: block;
  width: 100%;
  height: calc(${({ theme }) => theme.spaces[11]} * 7);
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral0};
`;

const TEMPLATE_TAB_LABELS = {
  suspiciousLogin: ['settings.email.templates.tab.suspicious', 'Suspicious sign-in'],
  newLocation: ['settings.email.templates.tab.newLocation', 'New country'],
  vpnProxy: ['settings.email.templates.tab.vpnProxy', 'VPN or proxy'],
};

/**
 * Sub-section label inside the "Edit email templates" accordion. The
 * accordion header is already the h3 of the card, so these are labels, not
 * headings.
 *
 * @param {{ children: import('react').ReactNode }} props Label text.
 * @returns {import('react').ReactElement} Bold label.
 */
const BlockLabel = ({ children }) => (
  <Typography variant="omega" fontWeight="bold" tag="div" textColor="neutral800">
    {children}
  </Typography>
);

/**
 * One alert type: subject, variables, HTML and text sources.
 *
 * @param {{ templateKey: string, template: object, templates: object, handleChange: Function, copyValue: Function, errors: object }} props Template draft and helpers.
 * @returns {import('react').ReactElement} Template editor.
 */
const TemplateEditor = ({ templateKey, template, templates, handleChange, copyValue, errors }) => {
  const { t, tError } = useSettingsTranslate();
  const { toggleNotification } = useNotification();
  const defaults = getDefaultTemplates()[templateKey];

  const setField = (field, value) => {
    handleChange('emailTemplates', updateEmailTemplate(templates, templateKey, field, value));
  };

  const loadDefault = (field) => {
    handleChange('emailTemplates', updateEmailTemplate(templates, templateKey, field, defaults[field]));
    toggleNotification({ type: 'success', message: t('notifications.success.defaultLoaded', 'Default template loaded.') });
  };

  const validateVariables = () => {
    const validation = findTemplateVariables(template.html, templateKey);
    toggleNotification({
      type: validation.found.length > 0 ? 'success' : 'warning',
      message: validation.found.length > 0
        ? t('notifications.success.validated', 'Template checked: {found} of {total} variables found.', { found: validation.found.length, total: validation.total })
        : t('notifications.warning.noVariables', 'No variables found. Add at least one variable.'),
    });
  };

  const loadDefaultAction = (field, labelId, labelDefault) => (
    <ConfirmAction
      variant="danger-light"
      disabled={template[field] === defaults[field]}
      trigger={(
        <Button variant="tertiary" size="S" disabled={template[field] === defaults[field]}>
          {t(labelId, labelDefault)}
        </Button>
      )}
      title={t('settings.email.templates.loadDefault.confirmTitle', 'Replace this template with the default?')}
      body={t('settings.email.templates.loadDefault.confirmBody', 'Your edits to this template are replaced. They are only stored when you save the settings.')}
      confirmLabel={t(labelId, labelDefault)}
      onConfirm={() => loadDefault(field)}
    />
  );

  return (
    <Flex direction="column" alignItems="stretch" gap={6} paddingTop={6}>
      <FormField
        id={`email-template-subject-${templateKey}`}
        name={`emailTemplateSubject-${templateKey}`}
        label={t('settings.email.templates.subject', 'Email subject')}
        description={t('settings.email.templates.subjectHint', 'This subject line is used for the selected alert type.')}
        error={tError(errors[`emailTemplates.${templateKey}.subject`])}
      >
        <TextInput
          value={template.subject}
          onChange={(event) => setField('subject', event.target.value)}
          placeholder={t('settings.email.templates.subjectPlaceholder', 'Enter the email subject')}
        />
      </FormField>

      <Flex direction="column" alignItems="stretch" gap={3}>
        <BlockLabel>{t('settings.email.templates.variables', 'Available variables')}</BlockLabel>
        <VariableGridFrame>
          <VariableGrid data-template-variables="">
            {TEMPLATE_VARIABLES[templateKey].map((variable) => {
              const definition = TEMPLATE_VARIABLE_DEFINITIONS[variable];
              return (
                <Fragment key={variable}>
                  <Box>
                    <Tag
                      icon={<Duplicate aria-hidden focusable={false} />}
                      label={t('settings.email.templates.copyVariable', 'Copy {variable}', { variable })}
                      onClick={() => copyValue(
                        variable,
                        t('notifications.success.variableCopied', '{variable} copied.', { variable }),
                        'settings.copyTemplateVariable'
                      )}
                    >
                      {variable}
                    </Tag>
                  </Box>
                  <Typography variant="pi" textColor="neutral600">
                    {t(definition.messageId, definition.defaultMessage)}
                  </Typography>
                </Fragment>
              );
            })}
          </VariableGrid>
        </VariableGridFrame>
      </Flex>

      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
          <Flex gap={2} alignItems="center" wrap="wrap">
            <BlockLabel>{t('settings.email.templates.html.title', 'HTML template')}</BlockLabel>
            <Badge>{t('settings.email.templates.html.badge', 'Main template')}</Badge>
          </Flex>
          {loadDefaultAction('html', 'settings.email.templates.html.loadDefault', 'Load default')}
        </Flex>
        <FormField
          id={`email-template-html-${templateKey}`}
          name={`emailTemplateHtml-${templateKey}`}
          label={t('settings.email.templates.html.editorLabel', 'HTML template source')}
          description={t('settings.email.templates.html.description', "HTML template for email notifications. Use variables like '{{user.email}}' for dynamic content.")}
          error={tError(errors[`emailTemplates.${templateKey}.html`])}
        >
          <CodeTextarea
            rows={18}
            spellCheck={false}
            value={template.html}
            onChange={(event) => setField('html', event.target.value)}
            placeholder={t('settings.email.templates.html.placeholder', 'Enter the HTML template. Variables are replaced when the email is sent.')}
          />
        </FormField>
        <Flex gap={2} wrap="wrap">
          <Button
            variant="secondary"
            size="S"
            startIcon={<Duplicate aria-hidden focusable={false} />}
            onClick={() => copyValue(template.html, t('notifications.success.htmlCopied', 'HTML template copied.'), 'settings.copyHtmlTemplate')}
          >
            {t('settings.email.templates.html.copy', 'Copy template')}
          </Button>
          <Button variant="secondary" size="S" onClick={validateVariables}>
            {t('settings.email.templates.html.validate', 'Validate')}
          </Button>
        </Flex>
      </Flex>

      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
          <Flex gap={2} alignItems="center" wrap="wrap">
            <BlockLabel>{t('settings.email.templates.text.title', 'Text template')}</BlockLabel>
            <Badge>{t('settings.email.templates.text.badge', 'Fallback')}</Badge>
          </Flex>
          {loadDefaultAction('text', 'settings.email.templates.text.loadDefault', 'Load default')}
        </Flex>
        <FormField
          id={`email-template-text-${templateKey}`}
          name={`emailTemplateText-${templateKey}`}
          label={t('settings.email.templates.text.editorLabel', 'Plain text template source')}
          description={t('settings.email.templates.text.description', 'Plain text version (no HTML) as fallback for older email clients')}
          error={tError(errors[`emailTemplates.${templateKey}.text`])}
        >
          <CodeTextarea
            rows={12}
            spellCheck={false}
            value={template.text}
            onChange={(event) => setField('text', event.target.value)}
            placeholder={t('settings.email.templates.text.placeholder', 'Enter the plain text version without HTML.')}
          />
        </FormField>
        <Flex gap={2} wrap="wrap">
          <Button
            variant="secondary"
            size="S"
            startIcon={<Duplicate aria-hidden focusable={false} />}
            onClick={() => copyValue(template.text, t('notifications.success.textCopied', 'Text template copied.'), 'settings.copyTextTemplate')}
          >
            {t('settings.email.templates.text.copy', 'Copy template')}
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
};

/**
 * E-mail template editor (one tab per alert type) and a sandboxed preview
 * rendered with synthetic sample data. Rendered inside the "Edit email
 * templates" accordion of the card "Security emails to users" (IA F 4.1 #5).
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Template editor and preview.
 */
const EmailTemplatesCard = ({ form }) => {
  const { t } = useSettingsTranslate();
  const { settings, handleChange, copyValue, errors } = form;
  const [activeTemplateTab, setActiveTemplateTab] = useState('suspiciousLogin');
  const templates = settings.emailTemplates;
  const active = templates[activeTemplateTab];
  const errorTemplate = TEMPLATE_KEYS.find((key) => Object.keys(errors).some((path) => path.startsWith(`emailTemplates.${key}.`)));

  return (
    <Flex direction="column" alignItems="stretch" gap={6} data-email-templates="">
      <Tabs.Root value={activeTemplateTab} onValueChange={setActiveTemplateTab} hasError={errorTemplate}>
        <TemplateTabsList aria-label={t('settings.config.email.templates.field', 'Email templates')}>
          {TEMPLATE_KEYS.map((key) => (
            <Tabs.Trigger key={key} value={key}>
              {t(TEMPLATE_TAB_LABELS[key][0], TEMPLATE_TAB_LABELS[key][1])}
            </Tabs.Trigger>
          ))}
        </TemplateTabsList>
        {TEMPLATE_KEYS.map((templateKey) => (
          <Tabs.Content key={templateKey} value={templateKey}>
            <TemplateEditor
              templateKey={templateKey}
              template={templates[templateKey]}
              templates={templates}
              handleChange={handleChange}
              copyValue={copyValue}
              errors={errors}
            />
          </Tabs.Content>
        ))}
      </Tabs.Root>

      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex direction="column" alignItems="stretch" gap={1}>
          <BlockLabel>{t('settings.email.templates.preview.title', 'Preview')}</BlockLabel>
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('settings.email.templates.preview.subtitle', 'The selected template rendered with sample data. Scripts and links are disabled.')}
          </Typography>
        </Flex>
        <Flex direction="column" alignItems="stretch" gap={1}>
          <Typography variant="sigma" textColor="neutral600" tag="div">
            {t('settings.email.templates.subject', 'Email subject')}
          </Typography>
          <Typography variant="omega" textColor="neutral800" tag="div">
            {renderTemplatePreview(active.subject)}
          </Typography>
        </Flex>
        <PreviewFrame
          title={t('settings.email.templates.preview.frameTitle', 'Email preview: {template}', {
            template: t(TEMPLATE_TAB_LABELS[activeTemplateTab][0], TEMPLATE_TAB_LABELS[activeTemplateTab][1]),
          })}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={renderTemplatePreview(active.html, { html: true })}
        />
      </Flex>
    </Flex>
  );
};

export default EmailTemplatesCard;
