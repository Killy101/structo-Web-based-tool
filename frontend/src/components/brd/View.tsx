import Generate from "./Generate";

interface Props {
	brdId?: string;
	title?: string;
	format?: "new" | "old";
	onComplete?: () => void;
}

export default function View({ brdId, title, format, onComplete }: Props) {
	return (
		<Generate
			brdId={brdId}
			title={title}
			format={format}
			onComplete={onComplete}
			canEdit={false}
		/>
	);
}
