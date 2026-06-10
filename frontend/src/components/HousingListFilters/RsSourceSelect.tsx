import { RS_SOURCE_VALUES, type RsSource } from '@zerologementvacant/models';

import Select, { type SelectProps } from '~/components/ui/Select/Select';
import {
  RS_SOURCE_EMPTY_OPTION,
  RS_SOURCE_OPTIONS
} from '~/models/HousingFilters';

export type RsSourceSelectProps<Multiple extends boolean> = Pick<
  SelectProps<RsSource | null, Multiple>,
  'className' | 'disabled' | 'error' | 'multiple' | 'value' | 'onChange'
>;

function RsSourceSelect<Multiple extends boolean = false>(
  props: RsSourceSelectProps<Multiple>
) {
  return (
    <Select
      {...props}
      options={[...RS_SOURCE_VALUES, RS_SOURCE_EMPTY_OPTION.value]}
      label="Source RS"
      getOptionLabel={(option) =>
        option === RS_SOURCE_EMPTY_OPTION.value
          ? RS_SOURCE_EMPTY_OPTION.label
          : RS_SOURCE_OPTIONS[option].label
      }
    />
  );
}

export default RsSourceSelect;
