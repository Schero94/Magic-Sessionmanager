import { useState } from 'react';
import { Badge, Box, Button, Flex, Tabs, Tag, Textarea, TextInput, Typography } from '@strapi/design-system';
import { useNotification } from '@strapi/strapi/admin';
import { Duplicate } from '@strapi/icons';
import styled from 'styled-components';
import { ConfirmAction, EqualGrid, SectionCard } from '../../components/ui';
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

const PreviewFrame = styled.iframe`
  display: block;
  width: 100%;
  height: calc(${({ theme }) => theme.spaces[11]} * 7);
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral0};
`;

const TEMPLATE_TAB_LABELS = {
  suspiciousLogin: ['settings.email.templates.tab.suspicious', 'Suspicious Login'],
  newLocation: ['settings.email.templates.tab.newLocation', 'New Location'],
  vpnProxy: ['settings.email.templates.tab.vpnProxy', 'VPN/Proxy'],
};

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
    toggleNotification({ type: 'success', message: t('notifications.success.defaultLoaded', 'Default template loaded!') });
  };

  const validateVariables = () => {
    const validation = findTemplateVariables(template.html, templateKey);
    toggleNotification({
      type: validation.found.length > 0 ? 'success' : 'warning',
      message: validation.found.length > 0
        ? t('notifications.success.validated', 'Template valid! Found {found}/{total} variables.', { found: validation.found.length, total: validation.total })
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
        label={t('settings.email.templates.subject', 'Email Subject')}
        description={t('settings.email.templates.subjectHint', 'This subject line is used for the selected alert type.')}
        error={tError(errors[`emailTemplates.${templateKey}.subject`])}
      >
        <TextInput
          value={template.subject}
          onChange={(event) => setField('subject', event.target.value)}
          placeholder={t('settings.email.templates.subjectPlaceholder', 'Enter email subject...')}
        />
      </FormField>

      <Flex direction="column" alignItems="stretch" gap={3}>
        <Typography variant="delta" tag="h3" textColor="neutral800">
          {t('settings.email.templates.variables', 'Available variables')}
        </Typography>
        <EqualGrid columns={2} stackBelow="medium" gap={3}>
          {TEMPLATE_VARIABLES[templateKey].map((variable) => {
            const definition = TEMPLATE_VARIABLE_DEFINITIONS[variable];
            return (
              <Flex key={variable} gap={3} alignItems="center" wrap="wrap" minWidth={0}>
                <Tag
                  icon={<Duplicate aria-hidden focusable={false} />}
                  label={t('settings.email.templates.copyVariable', 'Copy {variable}', { variable })}
                  onClick={() => copyValue(
                    variable,
                    t('notifications.success.variableCopied', '{variable} copied!', { variable }),
                    'settings.copyTemplateVariable'
                  )}
                >
                  {variable}
                </Tag>
                <Typography variant="pi" textColor="neutral600">
                  {t(definition.messageId, definition.defaultMessage)}
                </Typography>
              </Flex>
            );
          })}
        </EqualGrid>
      </Flex>

      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
          <Flex gap={2} alignItems="center" wrap="wrap">
            <Typography variant="delta" tag="h3" textColor="neutral800">
              {t('settings.email.templates.html.title', 'HTML Template')}
            </Typography>
            <Badge>{t('settings.email.templates.html.badge', 'Main Template')}</Badge>
          </Flex>
          {loadDefaultAction('html', 'settings.email.templates.html.loadDefault', 'Load Default')}
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
            onClick={() => copyValue(template.html, t('notifications.success.htmlCopied', 'HTML template copied!'), 'settings.copyHtmlTemplate')}
          >
            {t('settings.email.templates.html.copy', 'Copy Template')}
          </Button>
          <Button variant="secondary" size="S" onClick={validateVariables}>
            {t('settings.email.templates.html.validate', 'Validate')}
          </Button>
        </Flex>
      </Flex>

      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
          <Flex gap={2} alignItems="center" wrap="wrap">
            <Typography variant="delta" tag="h3" textColor="neutral800">
              {t('settings.email.templates.text.title', 'Text Template')}
            </Typography>
            <Badge>{t('settings.email.templates.text.badge', 'Fallback')}</Badge>
          </Flex>
          {loadDefaultAction('text', 'settings.email.templates.text.loadDefault', 'Load Default')}
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
            onClick={() => copyValue(template.text, t('notifications.success.textCopied', 'Text template copied!'), 'settings.copyTextTemplate')}
          >
            {t('settings.email.templates.text.copy', 'Copy Template')}
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
};

/**
 * E-mail template editor (one tab per alert type) and a sandboxed preview
 * rendered with synthetic sample data.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Template and preview sections.
 */
const EmailTemplatesCard = ({ form }) => {
  const { t } = useSettingsTranslate();
  const { settings, handleChange, copyValue, errors } = form;
  const [activeTemplateTab, setActiveTemplateTab] = useState('suspiciousLogin');
  const templates = settings.emailTemplates;
  const active = templates[activeTemplateTab];
  const errorTemplate = TEMPLATE_KEYS.find((key) => Object.keys(errors).some((path) => path.startsWith(`emailTemplates.${key}.`)));

  return (
    <>
      <SectionCard
        title={t('settings.email.templates.title', 'Email templates')}
        subtitle={t('settings.email.templates.subtitle', 'Customize email notification templates with dynamic variables')}
      >
        <Tabs.Root value={activeTemplateTab} onValueChange={setActiveTemplateTab} hasError={errorTemplate}>
          <TemplateTabsList aria-label={t('settings.email.templates.title', 'Email templates')}>
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
      </SectionCard>

      <SectionCard
        title={t('settings.email.templates.preview.title', 'Preview')}
        subtitle={t('settings.email.templates.preview.subtitle', 'The selected template rendered with sample data. Scripts and links are disabled.')}
      >
        <Box>
          <Typography variant="sigma" textColor="neutral600" tag="p">
            {t('settings.email.templates.subject', 'Email Subject')}
          </Typography>
          <Typography variant="omega" textColor="neutral800" tag="p">
            {renderTemplatePreview(active.subject)}
          </Typography>
        </Box>
        <PreviewFrame
          title={t('settings.email.templates.preview.frameTitle', 'Email preview: {template}', {
            template: t(TEMPLATE_TAB_LABELS[activeTemplateTab][0], TEMPLATE_TAB_LABELS[activeTemplateTab][1]),
          })}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={renderTemplatePreview(active.html, { html: true })}
        />
      </SectionCard>
    </>
  );
};

export default EmailTemplatesCard;
