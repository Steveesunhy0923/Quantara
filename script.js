const problemTemplates = [
    {
        name: "SumOfTwo",
        question: "What is a + b?",
        generateProblem: function() {
            // Generate random numbers for a and b
            const a = Math.floor(Math.random() * 10) + 1; // 1 to 10
            const b = Math.floor(Math.random() * 10) + 1; // 1 to 10

            // Compute the correct answer
            const correctAnswer = a + b;

            // Generate some distractors (incorrect answers)
            // Feel free to refine how you generate distractors
            let distractors = [];
            while (distractors.length < 3) {
                let randWrong = Math.floor(Math.random() * 20) + 1;
                // Ensure we don't add a duplicate or the correct answer
                if (randWrong !== correctAnswer && !distractors.includes(randWrong)) {
                    distractors.push(randWrong);
                }
            }

            // Return the problem object
            return {
                questionText: `What is ${a} + ${b}?`,
                correctAnswer,
                distractors
            };
        }
    },

    // You could add more templates here, for example:
    // {
    //   name: "SumOfThree",
    //   question: "What is a + b + c?",
    //   generateProblem: function() { ... }
    // }
];

// Global variables to track current problem and score
let currentProblem = null;
let userScore = 0;
let totalAnswered = 0;

// This function picks a random template, generates a new problem instance,
// and displays it to the user
function nextProblem() {
    // Clear feedback when moving to the next question
    document.getElementById("feedback").textContent = "";

    // Randomly pick a template
    const randomIndex = Math.floor(Math.random() * problemTemplates.length);
    const chosenTemplate = problemTemplates[randomIndex];

    // Generate a new problem instance
    currentProblem = chosenTemplate.generateProblem();

    // Display the question
    document.getElementById("problem").textContent = currentProblem.questionText;

    // Combine the correct answer with distractors, and shuffle them
    const allAnswers = [currentProblem.correctAnswer, ...currentProblem.distractors];
    shuffleArray(allAnswers);

    // Build a set of radio buttons for the multiple-choice answers
    const choicesDiv = document.getElementById("choices");
    choicesDiv.innerHTML = ""; // Clear any existing choices

    allAnswers.forEach(answer => {
        const label = document.createElement("label");
        label.classList.add("choice");

        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "answer";
        radio.value = answer;

        label.appendChild(radio);
        label.appendChild(document.createTextNode(" " + answer));
        choicesDiv.appendChild(label);
    });
}

// This function checks which radio button is selected, compares with the correct answer,
// updates score, and displays feedback
function checkAnswer() {
    const radios = document.getElementsByName("answer");
    let selectedValue = null;
    for (let i = 0; i < radios.length; i++) {
        if (radios[i].checked) {
            selectedValue = Number(radios[i].value);
            break;
        }
    }

    // If no answer is selected, show a prompt
    if (selectedValue === null) {
        document.getElementById("feedback").textContent = "Please select an answer first!";
        return;
    }

    // Increase total attempts
    totalAnswered++;

    // Check correctness
    if (selectedValue === currentProblem.correctAnswer) {
        userScore++;
        document.getElementById("feedback").textContent = "Correct!";
    } else {
        document.getElementById("feedback").textContent = `Incorrect. The correct answer was ${currentProblem.correctAnswer}.`;
    }

    // Update score display
    document.getElementById("score").textContent =
        `Score: ${userScore} / ${totalAnswered}`;
}

// Utility function to shuffle an array in-place (Fisher-Yates shuffle)
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// On page load, generate the first problem
window.onload = function() {
    nextProblem();
};