import Tag from '@codegouvfr/react-dsfr/Tag';
import { RS_SOURCE_LABELS, type RsSource } from '@zerologementvacant/models';

interface RsSourceTagProps {
  rsSource: RsSource | null;
  tagProps?: {
    className?: string;
    small?: boolean;
  };
}

function RsSourceTag(props: RsSourceTagProps) {
  if (!props.rsSource) {
    return null;
  }

  return (
    <Tag {...props.tagProps}>
      {`Source RS : ${RS_SOURCE_LABELS[props.rsSource]}`}
    </Tag>
  );
}

export default RsSourceTag;
