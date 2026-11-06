import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'styled-components';
import { lightTheme, SingleSelect, SingleSelectOption, TextInput } from '@strapi/design-system';
import FormField from '../../admin/src/components/FormField.jsx';
import translations from '../../admin/src/translations/en.json';

createRoot(document.getElementById('root')).render(
  <ThemeProvider theme={lightTheme}>
    <FormField
      id="provider"
      label="Provider"
      description={translations['settings.geofencing.provider.hint']}
    >
      <SingleSelect value="auto" onChange={() => {}}>
        <SingleSelectOption value="auto">Auto</SingleSelectOption>
      </SingleSelect>
    </FormField>
    <FormField id="search" label="Search" description="Search session records.">
      <TextInput value="" onChange={() => {}} />
    </FormField>
    <FormField id="template" label="Template" description="Edit this template.">
      <textarea id="template" aria-describedby="template-hint" />
    </FormField>
    <FormField id="plain" label="Plain">
      <TextInput value="" onChange={() => {}} />
    </FormField>
  </ThemeProvider>
);
