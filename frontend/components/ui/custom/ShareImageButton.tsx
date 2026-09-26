import { Share } from "lucide-react";
import React from "react";

interface Props {
  imageUrl: string;
}

const ShareImageButton: React.FC<Props> = ({ imageUrl }) => {
  const share = () => {
    const text = encodeURIComponent(imageUrl);

    window.open(
      `https://wa.me/?text=${text}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <button
      className="
        fixed
        top-4
        right-4
        z-[100]
        flex
        items-center
        justify-center
        rounded-lg
        border-2
        border-black
        bg-white
        px-4
        py-2
        text-sm
        font-semibold
        text-black
        shadow-lg
        transition-colors
        hover:bg-black
        hover:text-white
        active:scale-95
      "
      onClick={share}
    >
      <Share />
    </button>
  );
};

export default ShareImageButton;
